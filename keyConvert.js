const fs = require('fs');
const key = fs.readFileSync("./public-infrastructure-issue.json", 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)