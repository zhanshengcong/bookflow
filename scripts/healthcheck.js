const http = require('http');
const url = process.argv[2] || 'http://localhost:3001/api/health';
http.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  });
}).on('error', () => {
  process.exit(1);
});
