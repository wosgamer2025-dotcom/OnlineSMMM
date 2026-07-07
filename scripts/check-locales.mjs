import { locales } from '../src/content.js';

const baseLocale = locales.tr;
const missing = [];

function walk(baseValue, compareValue, path = []) {
  if (Array.isArray(baseValue)) {
    if (!Array.isArray(compareValue)) {
      missing.push(path.join('.'));
      return;
    }
    baseValue.forEach((item, index) => walk(item, compareValue[index], [...path, index]));
    return;
  }

  if (baseValue && typeof baseValue === 'object') {
    if (!compareValue || typeof compareValue !== 'object') {
      missing.push(path.join('.'));
      return;
    }
    Object.keys(baseValue).forEach((key) => walk(baseValue[key], compareValue[key], [...path, key]));
  }
}

Object.entries(locales).forEach(([code, locale]) => {
  if (code === 'tr') return;
  missing.length = 0;
  walk(baseLocale, locale);
  if (missing.length) {
    console.error(`Locale ${code} is missing ${missing.length} key(s):`);
    missing.slice(0, 20).forEach((entry) => console.error(`- ${entry}`));
    process.exitCode = 1;
  }
});

if (!process.exitCode) {
  console.log('All locales contain the Turkish base structure.');
}
