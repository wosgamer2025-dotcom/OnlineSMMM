import { describe, expect, test } from 'vitest';
import { mergeStoreForSave } from './data-store.js';

describe('data store stale write merging', () => {
  test('keeps notification fields when a newer visit heartbeat saves a stale snapshot', () => {
    const latest = {
      customerVisits: [
        {
          id: 'visit-1',
          sessionId: 'session-1',
          lastSeenAt: '2026-07-07T10:00:00.000Z',
          entryNotificationSentAt: '2026-07-07T10:00:00.000Z',
          entryWhatsappForwardedTo: ['Super Admin WhatsApp'],
          entryEmailDeliveryId: 'mail-1',
        },
      ],
    };
    const incoming = {
      customerVisits: [
        {
          id: 'visit-1',
          sessionId: 'session-1',
          lastSeenAt: '2026-07-07T10:01:00.000Z',
          pageViews: 2,
        },
      ],
    };

    const merged = mergeStoreForSave(latest, incoming);

    expect(merged.customerVisits[0]).toMatchObject({
      sessionId: 'session-1',
      lastSeenAt: '2026-07-07T10:01:00.000Z',
      entryNotificationSentAt: '2026-07-07T10:00:00.000Z',
      entryWhatsappForwardedTo: ['Super Admin WhatsApp'],
      entryEmailDeliveryId: 'mail-1',
      pageViews: 2,
    });
  });

  test('does not downgrade a sent mail delivery back to queued', () => {
    const latest = {
      mailDeliveries: [
        {
          id: 'mail-1',
          status: 'sent',
          updatedAt: '2026-07-07T10:01:00.000Z',
          sentAt: '2026-07-07T10:01:00.000Z',
        },
      ],
    };
    const incoming = {
      mailDeliveries: [
        {
          id: 'mail-1',
          status: 'queued',
          updatedAt: '2026-07-07T10:00:00.000Z',
          queuedAt: '2026-07-07T10:00:00.000Z',
        },
      ],
    };

    expect(mergeStoreForSave(latest, incoming).mailDeliveries[0]).toMatchObject({
      id: 'mail-1',
      status: 'sent',
      sentAt: '2026-07-07T10:01:00.000Z',
    });
  });

  test('keeps the freshest WhatsApp connection status without blocking explicit deletion', () => {
    const latest = {
      whatsappConnections: [
        {
          id: 'wa-1',
          status: 'ready',
          lastHeartbeatAt: '2026-07-07T10:01:00.000Z',
        },
      ],
    };
    const staleIncoming = {
      whatsappConnections: [
        {
          id: 'wa-1',
          status: 'disconnected',
          lastHeartbeatAt: '2026-07-07T10:00:00.000Z',
        },
      ],
    };

    expect(mergeStoreForSave(latest, staleIncoming).whatsappConnections[0]).toMatchObject({
      id: 'wa-1',
      status: 'ready',
    });
    expect(mergeStoreForSave(latest, { whatsappConnections: [] }).whatsappConnections).toEqual([]);
  });
});
