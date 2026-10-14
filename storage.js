// Ukladanie nastavení (ID tímu, ...). Funguje, ak je nainštalovaný AsyncStorage.
let AS = null;
try {
  AS = require('@react-native-async-storage/async-storage').default;
} catch (e) {}

export async function loadPrefs() {
  try {
    return AS ? JSON.parse((await AS.getItem('fpl-prefs')) || '{}') : {};
  } catch (e) {
    return {};
  }
}
export async function savePrefs(obj) {
  try {
    if (AS) await AS.setItem('fpl-prefs', JSON.stringify(obj));
  } catch (e) {}
}

export async function getCache(key) {
  try {
    return AS ? JSON.parse(await AS.getItem(key)) : null;
  } catch (e) {
    return null;
  }
}
export async function setCache(key, val) {
  try {
    if (AS) await AS.setItem(key, JSON.stringify(val));
  } catch (e) {}
}
