import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  __resetWhatsAppRuntimeForTest,
  __setWhatsAppRuntimeForTest,
  describeChromeLaunchFailure,
  getWhatsAppWebVersionOptions,
  getPuppeteerArgs,
  listWhatsAppConnectionStates,
  sanitizePhone,
  sendWhatsAppMessage,
} from './whatsapp-service.js';

afterEach(async () => {
  await __resetWhatsAppRuntimeForTest();
});

describe('WhatsApp runtime reliability', () => {
  test('sanitizes phone numbers before sending to whatsapp-web.js', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    __setWhatsAppRuntimeForTest('conn-1', {
      client: { sendMessage, destroy: vi.fn() },
      state: { id: 'conn-1', status: 'ready' },
    });

    await sendWhatsAppMessage('conn-1', '+90 (532) 610 32 64', 'Merhaba');

    expect(sendMessage).toHaveBeenCalledWith('905326103264@c.us', 'Merhaba');
  });

  test('queues messages sequentially per connection', async () => {
    const order = [];
    const sendMessage = vi.fn(async (_to, body) => {
      order.push(`start:${body}`);
      await new Promise((resolve) => setTimeout(resolve, body === 'first' ? 20 : 1));
      order.push(`end:${body}`);
    });
    __setWhatsAppRuntimeForTest('conn-2', {
      client: { sendMessage, destroy: vi.fn() },
      state: { id: 'conn-2', status: 'ready' },
    });

    await Promise.all([
      sendWhatsAppMessage('conn-2', '905551112233', 'first'),
      sendWhatsAppMessage('conn-2', '905551112233', 'second'),
    ]);

    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  test('fails clearly when a session is not ready', async () => {
    __setWhatsAppRuntimeForTest('conn-3', {
      client: { sendMessage: vi.fn(), destroy: vi.fn() },
      state: { id: 'conn-3', status: 'qr' },
    });

    await expect(sendWhatsAppMessage('conn-3', '905551112233', 'test')).rejects.toThrow('hazir degil');
    expect(listWhatsAppConnectionStates()).toEqual([
      expect.objectContaining({ id: 'conn-3', status: 'qr' }),
    ]);
  });

  test('normalizes phone values consistently', () => {
    expect(sanitizePhone('+90 (555) 555 55 55')).toBe('905555555555');
  });

  test('explains missing Chrome system libraries clearly', () => {
    const message = describeChromeLaunchFailure(new Error('error while loading shared libraries: libgbm.so.1: cannot open shared object file'));

    expect(message).toContain('Chrome/Chromium sistem kütüphaneleri eksik');
    expect(message).toContain('libgbm1');
  });

  test('keeps single-process Chrome mode opt-in', () => {
    const previous = process.env.WHATSAPP_CHROME_SINGLE_PROCESS;
    delete process.env.WHATSAPP_CHROME_SINGLE_PROCESS;
    expect(getPuppeteerArgs()).not.toContain('--single-process');

    process.env.WHATSAPP_CHROME_SINGLE_PROCESS = 'true';
    expect(getPuppeteerArgs()).toContain('--single-process');
    if (previous === undefined) {
      delete process.env.WHATSAPP_CHROME_SINGLE_PROCESS;
    } else {
      process.env.WHATSAPP_CHROME_SINGLE_PROCESS = previous;
    }
  });

  test('uses the package web version cache by default and allows env pinning', () => {
    const previous = {
      WHATSAPP_WEB_VERSION: process.env.WHATSAPP_WEB_VERSION,
      WHATSAPP_WEB_VERSION_REMOTE_PATH: process.env.WHATSAPP_WEB_VERSION_REMOTE_PATH,
      WHATSAPP_WEB_VERSION_CACHE_TYPE: process.env.WHATSAPP_WEB_VERSION_CACHE_TYPE,
    };
    delete process.env.WHATSAPP_WEB_VERSION;
    delete process.env.WHATSAPP_WEB_VERSION_REMOTE_PATH;
    delete process.env.WHATSAPP_WEB_VERSION_CACHE_TYPE;

    expect(getWhatsAppWebVersionOptions()).toEqual({});

    process.env.WHATSAPP_WEB_VERSION = '2.3000.1017054665';
    process.env.WHATSAPP_WEB_VERSION_REMOTE_PATH = 'https://example.com/wa/{version}.html';
    expect(getWhatsAppWebVersionOptions()).toMatchObject({
      webVersion: '2.3000.1017054665',
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://example.com/wa/{version}.html',
      },
    });

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
});
