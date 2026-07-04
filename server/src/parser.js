import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import AdmZip from 'adm-zip'
import xml2js from 'xml2js'
import { promisify } from 'util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const parseXml = promisify(xml2js.parseString)
const COVERS_DIR = path.join(__dirname, '../../cache/covers')

if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true })

// ─── EPUB ─────────────────────────────────────────────────────────────────────
export async function parseEpub(filePath, bookId) {
  try {
    const zip = new AdmZip(filePath)
    const entries = zip.getEntries()

    // 找 container.xml -> content.opf
    const containerEntry = entries.find(e =>
      e.entryName.toLowerCase() === 'meta-inf/container.xml'
    )
    if (!containerEntry) return fallbackMeta(filePath, 'epub')

    const containerXml = containerEntry.getData().toString('utf8')
    const container = await parseXml(containerXml)
    const opfRelPath = container?.container?.rootfiles?.[0]?.rootfile?.[0]?.['$']?.['full-path']
    if (!opfRelPath) return fallbackMeta(filePath, 'epub')

    const opfEntry = entries.find(e => e.entryName === opfRelPath)
    if (!opfEntry) return fallbackMeta(filePath, 'epub')

    const opfXml = opfEntry.getData().toString('utf8')
    const opf = await parseXml(opfXml)
    const metadata = opf?.package?.metadata?.[0]
    const manifest = opf?.package?.manifest?.[0]?.item || []
    const opfDir = path.dirname(opfRelPath)

    const title = getText(metadata?.['dc:title'])
    const author = getText(metadata?.['dc:creator'])
    const publisher = getText(metadata?.['dc:publisher'])
    const description = getText(metadata?.['dc:description'])
    const language = getText(metadata?.['dc:language'])
    const publishedDate = getText(metadata?.['dc:date'])
    const series = getMetaContent(metadata?.meta, 'calibre:series')
    const seriesIndex = parseFloat(getMetaContent(metadata?.meta, 'calibre:series_index')) || null
    const tags = getMetaTags(metadata?.['dc:subject'])

    // 封面图
    const coverPath = await extractEpubCover(zip, entries, manifest, opfDir, filePath, bookId)
    const stat = fs.statSync(filePath)

    return {
      title: title || path.basename(filePath, '.epub'),
      author, publisher, description, language, publishedDate,
      series, series_index: seriesIndex,
      tags: tags ? tags.join(',') : null,
      cover_path: coverPath,
      file_size: stat.size
    }
  } catch (e) {
    console.error('[parseEpub] Error:', filePath, e.message)
    return fallbackMeta(filePath, 'epub')
  }
}

async function extractEpubCover(zip, entries, manifest, opfDir, filePath, bookId) {
  try {
    // 方法1: manifest 中找 cover-image
    let coverItem = manifest.find(item =>
      item['$']?.properties === 'cover-image' ||
      item['$']?.id?.toLowerCase().includes('cover')
    )

    let coverHref = coverItem?.['$']?.href
    if (!coverHref) {
      // 方法2: 找文件名含 cover 的图片
      const coverEntry = entries.find(e =>
        /cover\.(jpg|jpeg|png|webp)/i.test(path.basename(e.entryName))
      )
      if (coverEntry) coverHref = coverEntry.entryName
    }

    if (coverHref) {
      const fullPath = path.join(opfDir, coverHref).replace(/\\/g, '/')
      const imgEntry = entries.find(e =>
        e.entryName === fullPath || e.entryName === coverHref
      )
      if (imgEntry) {
        // 用 bookId 作为文件名，确保唯一
        const id = bookId || Buffer.from(filePath).toString('base64url').slice(0, 32)
        const ext = path.extname(coverHref).replace(/\.(xhtml|html|htm)/i, '.jpg') || '.jpg'
        const outName = `${id}${ext}`
        const outPath = path.join(COVERS_DIR, outName)
        if (!fs.existsSync(outPath)) {
          fs.writeFileSync(outPath, imgEntry.getData())
        }
        return `/covers/${outName}`
      }
    }
  } catch (e) {
    console.warn('[extractEpubCover]', e.message)
  }
  return null
}

// ─── MOBI / AZW3 ──────────────────────────────────────────────────────────────
export async function parseMobiMeta(filePath, bookId) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(32)
    fs.readSync(fd, header, 0, 32, 0)

    // PalmDB header: 读取书名（前32字节）
    const rawTitle = header.slice(0, 32).toString('ascii').replace(/\x00/g, '').trim()

    const buf = Buffer.alloc(16)
    fs.readSync(fd, buf, 0, 16, 78) // PalmDoc header
    const numRecords = buf.readUInt16BE(8) // at offset 76+2=78 -> but just read title

    // 读 MOBI header for title/author
    // 简化: 读 EXTH 记录
    const allBuf = fs.readFileSync(filePath)
    fs.closeSync(fd)

    const title = extractMobiTitle(allBuf) || rawTitle || path.basename(filePath)
    const author = extractMobiExth(allBuf, 100)
    const publisher = extractMobiExth(allBuf, 101)
    const description = extractMobiExth(allBuf, 103)
    const coverPath = extractMobiCover(allBuf, filePath, bookId)
    const stat = fs.statSync(filePath)

    return {
      title: title || path.basename(filePath),
      author, publisher, description,
      cover_path: coverPath,
      file_size: stat.size
    }
  } catch (e) {
    console.error('[parseMobiMeta]', filePath, e.message)
    return fallbackMeta(filePath, 'mobi')
  }
}

function extractMobiTitle(buf) {
  try {
    // PalmDB: titleOffset at 0x44, titleLength at 0x48
    const titleOffset = buf.readUInt32BE(0x60)
    const titleLen = buf.readUInt32BE(0x64)
    if (titleOffset > 0 && titleLen > 0 && titleOffset + titleLen <= buf.length) {
      return buf.slice(titleOffset, titleOffset + titleLen).toString('utf8').trim()
    }
  } catch {}
  return null
}

function extractMobiExth(buf, type) {
  try {
    // Find MOBI header offset: after PalmDB 78+2 records*8 = palmdb header
    const numRec = buf.readUInt16BE(76)
    const mobiOffset = 78 + numRec * 8 + 2 // approx record0 start
    const rec0Start = buf.readUInt32BE(78) // record0 offset from PalmDB

    const mobiIdOffset = rec0Start + 16 // skip PalmDoc header
    if (buf.slice(mobiIdOffset, mobiIdOffset + 4).toString('ascii') !== 'MOBI') return null

    const headerLen = buf.readUInt32BE(mobiIdOffset + 20)
    const exthFlag = buf.readUInt32BE(mobiIdOffset + 128)
    if (!(exthFlag & 0x40)) return null // no EXTH

    const exthStart = rec0Start + 16 + headerLen
    if (buf.slice(exthStart, exthStart + 4).toString('ascii') !== 'EXTH') return null

    const exthLen = buf.readUInt32BE(exthStart + 4)
    const numFields = buf.readUInt32BE(exthStart + 8)
    let pos = exthStart + 12
    for (let i = 0; i < numFields; i++) {
      const recType = buf.readUInt32BE(pos)
      const recLen = buf.readUInt32BE(pos + 4)
      if (recType === type) {
        return buf.slice(pos + 8, pos + recLen).toString('utf8').trim()
      }
      pos += recLen
    }
  } catch {}
  return null
}

function extractMobiCover(buf, filePath, bookId) {
  try {
    const numRec = buf.readUInt16BE(76)
    const rec0Start = buf.readUInt32BE(78)
    const mobiIdOffset = rec0Start + 16
    if (buf.slice(mobiIdOffset, mobiIdOffset + 4).toString('ascii') !== 'MOBI') return null
    const headerLen = buf.readUInt32BE(mobiIdOffset + 20)
    const exthFlag = buf.readUInt32BE(mobiIdOffset + 128)
    if (!(exthFlag & 0x40)) return null
    const exthStart = rec0Start + 16 + headerLen
    if (buf.slice(exthStart, exthStart + 4).toString('ascii') !== 'EXTH') return null
    const numFields = buf.readUInt32BE(exthStart + 8)
    let pos = exthStart + 12
    let coverIndex = -1
    for (let i = 0; i < numFields; i++) {
      const recType = buf.readUInt32BE(pos)
      const recLen = buf.readUInt32BE(pos + 4)
      if (recType === 201) { // cover record offset
        coverIndex = buf.readUInt32BE(pos + 8)
      }
      pos += recLen
    }
    if (coverIndex < 0) return null

    // Find the first image record index
    const firstImageIndex = buf.readUInt32BE(mobiIdOffset + 108) // First Image record index
    const imgRecordIndex = firstImageIndex + coverIndex
    if (imgRecordIndex >= numRec) return null

    const imgOffset = buf.readUInt32BE(78 + imgRecordIndex * 8)
    const nextOffset = imgRecordIndex + 1 < numRec
      ? buf.readUInt32BE(78 + (imgRecordIndex + 1) * 8)
      : buf.length
    const imgData = buf.slice(imgOffset, nextOffset)

    // Check magic
    let ext = '.jpg'
    if (imgData[0] === 0x89 && imgData[1] === 0x50) ext = '.png'

    const id = bookId || Buffer.from(filePath).toString('base64url').slice(0, 32)
    const outName = `${id}${ext}`
    const outPath = path.join(COVERS_DIR, outName)
    if (!fs.existsSync(outPath)) fs.writeFileSync(outPath, imgData)
    return `/covers/${outName}`
  } catch {}
  return null
}

// ─── PDF (简单元数据) ──────────────────────────────────────────────────────────
export async function parsePdfMeta(filePath) {
  try {
    const stat = fs.statSync(filePath)
    const name = path.basename(filePath, '.pdf')
    return {
      title: name,
      author: null,
      file_size: stat.size,
      cover_path: null
    }
  } catch {
    return fallbackMeta(filePath, 'pdf')
  }
}

// ─── TXT ──────────────────────────────────────────────────────────────────────
export async function parseTxtMeta(filePath) {
  const stat = fs.statSync(filePath)
  return {
    title: path.basename(filePath, '.txt'),
    author: null,
    file_size: stat.size,
    cover_path: null
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function fallbackMeta(filePath, format) {
  const stat = fs.statSync(filePath)
  return {
    title: path.basename(filePath, '.' + format),
    author: null, publisher: null, description: null,
    cover_path: null, file_size: stat.size
  }
}
function getText(arr) {
  if (!arr) return null
  const v = Array.isArray(arr) ? arr[0] : arr
  return typeof v === 'object' ? v?.['_'] || null : v || null
}
function getMetaContent(metas, name) {
  if (!metas) return null
  const m = metas.find(m => m?.['$']?.name === name)
  return m?.['$']?.content || null
}
function getMetaTags(arr) {
  if (!arr) return []
  return arr.map(v => typeof v === 'object' ? v?.['_'] : v).filter(Boolean)
}
