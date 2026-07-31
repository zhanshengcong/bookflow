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

// ─── MOBI/AZW3 文本提取 ──────────────────────────────────────────────────────────
// 从 MOBI/AZW3 文件中提取可读文本内容，返回纯文本字符串
export function extractMobiText(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    const numRec = buf.readUInt16BE(76)
    if (numRec === 0 || numRec > 10000) return null

    // 获取每个 record 的偏移
    const records = []
    for (let i = 0; i < numRec; i++) {
      const offset = buf.readUInt32BE(78 + i * 8)
      records.push(offset)
    }

    // Record 0 包含 MOBI header
    const rec0Start = records[0]
    const mobiOffset = rec0Start + 16 // 跳过 PalmDoc header
    if (mobiOffset + 4 > buf.length) return null
    if (buf.slice(mobiOffset, mobiOffset + 4).toString('ascii') !== 'MOBI') return null

    const mobiHeaderLen = buf.readUInt32BE(mobiOffset + 20)
    const compression = buf.readUInt16BE(mobiOffset + 0)
    const textLen = buf.readUInt32BE(mobiOffset + 4)
    const textRecordCount = buf.readUInt16BE(mobiOffset + 8)
    const textEncoding = buf.readUInt32BE(mobiOffset + 28)

    // 文本内容从 record 1 开始
    const textStartRecord = 1
    const textEndRecord = textStartRecord + textRecordCount - 1

    if (textEndRecord >= numRec) return null

    // 收集所有文本 record 数据
    const chunks = []
    let totalCollected = 0

    for (let i = textStartRecord; i <= textEndRecord && i < numRec; i++) {
      const start = records[i]
      const end = i + 1 < numRec ? records[i + 1] : buf.length
      let data = buf.slice(start, end)

      // MOBI 压缩: 1 = no compression, 2 = PalmDoc LZ77, 17480 = HUFF/CDIC
      if (compression === 2) {
        data = decompressPalmDoc(data, textLen - totalCollected)
      } else if (compression !== 1) {
        // HUFF/CDIC or unknown - skip
        continue
      }

      chunks.push(data)
      totalCollected += data.length
      if (totalCollected >= textLen) break
    }

    if (chunks.length === 0) return null

    const rawBytes = Buffer.concat(chunks)
    // 解码：1252 = CP1252, 65001 = UTF-8
    const encoding = textEncoding === 65001 ? 'utf8' : 'latin1'
    let text = rawBytes.toString(encoding)

    // 清理 HTML 标签，提取纯文本
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p[^>]*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<div[^>]*>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\0/g, '')
      .trim()

    if (!text || text.length < 50) return null
    return text
  } catch (e) {
    console.error('[extractMobiText]', filePath, e.message)
    return null
  }
}

// PalmDoc LZ77 解压
function decompressPalmDoc(data, maxLen) {
  const out = Buffer.alloc(maxLen || data.length * 4)
  let outPos = 0
  let pos = 0

  while (pos < data.length && outPos < out.length) {
    const flag = data[pos++]
    if (flag === undefined) break

    for (let bit = 0; bit < 8 && pos < data.length && outPos < out.length; bit++) {
      if (flag & (1 << bit)) {
        // 字面量
        out[outPos++] = data[pos++]
      } else {
        if (pos + 1 >= data.length) break
        const b1 = data[pos++]
        const b2 = data[pos++]
        const dist = ((b1 << 8) | b2) >> 3
        let len = (b2 & 0x7) + 3

        if (dist === 0) {
          // 特殊：escape
          out[outPos++] = 0
          continue
        }

        if (dist > outPos) {
          // 无效距离，跳过
          continue
        }

        for (let i = 0; i < len && outPos < out.length; i++) {
          out[outPos] = out[outPos - dist]
          outPos++
        }
      }
    }
  }

  return out.slice(0, outPos)
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

// ─── PDF (轻量级元数据提取，无需 pdfjs-dist) ──────────────────────────────────
export async function parsePdfMeta(filePath, bookId) {
  try {
    const stat = fs.statSync(filePath)
    const buf = fs.readFileSync(filePath)

    // 提取 PDF Info 字典中的元数据
    const meta = extractPdfInfo(buf)

    // 提取封面图片
    let coverPath = null
    try {
      coverPath = extractPdfCoverImage(buf, filePath, bookId)
    } catch { /* 封面提取失败不影响元数据 */ }

    return {
      title: meta.title || path.basename(filePath, '.pdf'),
      author: meta.author || null,
      publisher: null,
      description: meta.subject || null,
      file_size: stat.size,
      cover_path: coverPath,
      series: null,
      series_index: null,
      tags: null,
      language: null,
      publishedDate: meta.creationDate || null,
    }
  } catch {
    return fallbackMeta(filePath, 'pdf')
  }
}

// 从 PDF 二进制中解析 Info 字典
function extractPdfInfo(buf) {
  const result = {}

  // 方法1: 查找 trailer 中的 /Info 引用
  // PDF trailer 格式: trailer << /Size N /Info N 0 R /Root N 0 R >>
  const trailerMatch = buf.toString('latin1').match(/trailer\s*<<[\s\S]*?\/Info\s+(\d+)\s+(\d+)\s+R[\s\S]*?>>/)
  let infoObjNum = null

  if (trailerMatch) {
    infoObjNum = parseInt(trailerMatch[1])
  }

  // 方法2: 直接搜索 /Title, /Author 等关键字（适用于大多数 PDF）
  const text = buf.toString('latin1')

  // 提取带括号的字符串值（PDF 字符串格式: (text) 或 <hex>）
  const extractPdfString = (pattern) => {
    const m = text.match(pattern)
    if (!m) return null
    let val = m[1]
    // hex string <...>
    if (val.startsWith('<') && val.endsWith('>')) {
      const hex = val.slice(1, -1).replace(/\s/g, '')
      if (hex.length % 2 === 0) {
        const bytes = Buffer.from(hex, 'hex')
        // 尝试 UTF-16BE 解码（PDF 常见 Unicode 编码）
        if (bytes.length > 1 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
          return bytes.slice(2).toString('utf16le').replace(/\u0000/g, '')
        }
        return bytes.toString('utf8')
      }
      return null
    }
    // literal string (...)
    // 处理转义字符
    val = val.replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
             .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
             .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
    // 尝试 UTF-16BE 检测（BOM 或双字节特征）
    if (val.length > 2 && val.charCodeAt(0) === 0xFEFF) {
      return val.slice(1)
    }
    return val.trim()
  }

  result.title = extractPdfString(/\/Title\s*\(([^)]*(?:\\.[^)]*)*)\)|\/Title\s*<([0-9a-fA-F\s]+)>/i)
    || extractPdfString(/\/Title\s*\(([^)]*(?:\\.[^)]*)*)\)/i)
  result.author = extractPdfString(/\/Author\s*\(([^)]*(?:\\.[^)]*)*)\)|\/Author\s*<([0-9a-fA-F\s]+)>/i)
    || extractPdfString(/\/Author\s*\(([^)]*(?:\\.[^)]*)*)\)/i)
  result.subject = extractPdfString(/\/Subject\s*\(([^)]*(?:\\.[^)]*)*)\)|\/Subject\s*<([0-9a-fA-F\s]+)>/i)
  result.creationDate = extractPdfString(/\/CreationDate\s*\(([^)]*)\)/i)

  // 清理标题中的编码问题
  if (result.title) {
    // 移除 UTF-16 BOM 和 null 字符
    result.title = result.title.replace(/\u0000/g, '').replace(/^\uFEFF/, '').trim()
    if (result.title.length < 2) result.title = null
  }
  if (result.author) {
    result.author = result.author.replace(/\u0000/g, '').replace(/^\uFEFF/, '').trim()
    if (result.author.length < 2) result.author = null
  }

  return result
}

// ─── 从 PDF 二进制中提取封面图片（纯 JS，零依赖） ──────────────────────────
function extractPdfCoverImage(buf, filePath, bookId) {
  try {
    const text = buf.toString('latin1')

    // 找到所有 stream 对象
    // PDF 结构: N 0 obj << ... >> stream ...data... endstream endobj
    const streamRegex = /(\d+)\s+\d+\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n?([\s\S]*?)endstream/gi
    let match
    let bestImage = null
    let bestSize = 0

    while ((match = streamRegex.exec(text)) !== null) {
      const objNum = match[1]
      const dict = match[2]
      const dataStart = match.index + match[0].indexOf('stream') + 6

      // 检查是否是图片
      if (!/\/Subtype\s*\/Image/i.test(dict)) continue

      // 获取图片尺寸
      const wMatch = dict.match(/\/Width\s+(\d+)/i)
      const hMatch = dict.match(/\/Height\s+(\d+)/i)
      const w = wMatch ? parseInt(wMatch[1]) : 0
      const h = hMatch ? parseInt(hMatch[1]) : 0
      const area = w * h

      // 跳过太小的图片（可能是图标、logo等）
      if (area < 10000 || w < 100 || h < 100) continue

      // 解析 Filter 和实际数据
      const filterMatch = dict.match(/\/Filter\s*(\/\w+)/i)
      const filter = filterMatch ? filterMatch[1] : null

      // 读 stream 数据
      let dataEnd = text.indexOf('endstream', dataStart)
      if (dataEnd < 0) continue

      // 跳过可能的 \r\n 或 \n
      let actualStart = dataStart
      while (actualStart < dataEnd && (buf[actualStart] === 0x0d || buf[actualStart] === 0x0a)) {
        actualStart++
      }

      let imgData = buf.slice(actualStart, dataEnd)

      // 去除末尾空白
      while (imgData.length > 0 && (imgData[imgData.length - 1] === 0x0d || imgData[imgData.length - 1] === 0x0a || imgData[imgData.length - 1] === 0x20)) {
        imgData = imgData.slice(0, -1)
      }

      if (imgData.length < 500) continue

      // 判断图片格式
      let ext = '.jpg'
      let finalData = imgData

      // 检查是否是 JPEG（FF D8开头）
      if (imgData[0] === 0xFF && imgData[1] === 0xD8) {
        ext = '.jpg'
        finalData = imgData
      }
      // 检查 PNG
      else if (imgData[0] === 0x89 && imgData[1] === 0x50 && imgData[2] === 0x4E && imgData[3] === 0x47) {
        ext = '.png'
        finalData = imgData
      }
      // JPEG2000 (JPXDecode)
      else if (imgData[0] === 0xFF && imgData[1] === 0x4F && imgData[2] === 0xFF && imgData[3] === 0x51) {
        ext = '.jp2'
        finalData = imgData
      }
      // 其他编码的跳过（FlateDecode等需要解压）
      else if (filter && !/DCTDecode|JPXDecode/i.test(filter)) {
        // 非 JPEG/JPEG2000 编码，跳过（太复杂，需要解压）
        continue
      }
      // 可能是无 Filter 的原始数据
      else if (!filter) {
        // 没有 filter 但没有已知图片头——可能是原始像素数据，跳过
        if (imgData[0] !== 0xFF) continue
        ext = '.jpg'
        finalData = imgData
      }

      // 选择最大的图片
      if (area > bestSize) {
        bestSize = area
        bestImage = { data: finalData, ext }
      }
    }

    if (!bestImage) return null

    const id = bookId ? String(bookId) : Buffer.from(filePath).toString('base64url').slice(0, 32)
    const outName = `${id}_pdf${bestImage.ext}`
    const outPath = path.join(COVERS_DIR, outName)
    if (!fs.existsSync(outPath)) fs.writeFileSync(outPath, bestImage.data)
    return `/covers/${outName}`
  } catch (e) {
    console.error('[extractPdfCover]', filePath, e.message)
    return null
  }
}

// ─── TXT ──────────────────────────────────────────────────────────────────────
export async function parseTxtMeta(filePath) {
  const stat = fs.statSync(filePath)
  return {
    title: path.basename(filePath, '.txt'),
    author: null,
    publisher: null,
    description: null,
    file_size: stat.size,
    cover_path: null,
    series: null,
    series_index: null,
    tags: null,
    language: null,
    publishedDate: null,
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function fallbackMeta(filePath, format) {
  const stat = fs.statSync(filePath)
  return {
    title: path.basename(filePath, '.' + format),
    author: null, publisher: null, description: null,
    cover_path: null, file_size: stat.size,
    series: null, series_index: null, tags: null,
    language: null, publishedDate: null,
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
