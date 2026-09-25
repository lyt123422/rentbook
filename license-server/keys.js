// ============================================================
//  keys.js — 激活码生成与校验
//  格式：AMZ-XXXX-XXXX-XXXX，字符集去掉易混淆的 0/O/1/I
//  命令行用法：node keys.js [数量]，如 node keys.js 5
// ============================================================
'use strict';

const crypto = require('node:crypto');

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomGroup() {
  const bytes = crypto.randomBytes(4);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function generateKey() {
  return ['AMZ', randomGroup(), randomGroup(), randomGroup()].join('-');
}

function isValidKeyFormat(key) {
  return typeof key === 'string' &&
         /^AMZ(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){3}$/.test(key);
}

module.exports = { generateKey, isValidKeyFormat, ALPHABET };

// ── 命令行入口 ──
if (require.main === module) {
  const n = Math.max(1, Math.min(100, parseInt(process.argv[2], 10) || 1));
  for (let i = 0; i < n; i++) {
    console.log(generateKey());
  }
}
