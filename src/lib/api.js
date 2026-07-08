function getDefaultApiBase() {
  if (typeof window === 'undefined') {
    return 'http://localhost:4010';
  }
  
  const hostname = window.location.hostname;
  
  // Yerel ağ geliştirme ortamları
  const isLocal = 
    ['localhost', '127.0.0.1', '::1'].includes(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
    
  if (isLocal) {
    return `http://${hostname}:4010`;
  }
  
  // Cloudflare Pages üzerinde çalışıyorsa üretim VPS API'sini kullan
  if (hostname.endsWith('.pages.dev')) {
    return 'https://www.onlinesmmm.com';
  }
  
  return '';
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || getDefaultApiBase()).replace(/\/+$/, '');

export function getApiBase() {
  return apiBase || window.location.origin;
}

function getFriendlyApiErrorMessage(response, data, rawText = '') {
  const message = String(data?.message || '').trim();
  const text = String(rawText || message || '').trim();
  const looksLikeHtml = /^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text) || /<body[\s>]/i.test(text);
  if (looksLikeHtml) {
    if (response.status === 502 || /bad gateway/i.test(text)) {
      return 'Sunucu geçici olarak yanıt veremedi. Lütfen sayfayı yenileyip tekrar deneyin.';
    }
    return 'Sunucudan beklenmeyen bir yanıt alındı. Lütfen tekrar deneyin.';
  }
  if (response.status === 502) {
    return message || 'Sunucu geçici olarak yanıt veremedi. Lütfen tekrar deneyin.';
  }
  if (response.status === 503 || response.status === 504) {
    return message || 'Sunucu şu anda yanıt veremiyor. Lütfen kısa süre sonra tekrar deneyin.';
  }
  return message || response.statusText || 'API hatası';
}

function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiBase}${normalizedPath}`;
}

export async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  let response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...options,
      headers,
      credentials: 'include',
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Sunucu yanıtı zaman aşımına uğradı.');
    }
    throw new Error('Sunucuya bağlanılamadı.');
  } finally {
    window.clearTimeout(timeoutId);
  }

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: '' };
    }
  }

  if (!response.ok) {
    const error = new Error(getFriendlyApiErrorMessage(response, data, text));
    error.details = data;
    error.status = response.status;
    throw error;
  }

  return data;
}
