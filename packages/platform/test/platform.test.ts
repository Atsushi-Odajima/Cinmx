import { describe, it, expect } from 'vitest';
import { decideExportAd, readCloudConfig, NoOpPurchaseService, NoOpAdService, DevSimulatedAdService } from '../src';

describe('ad policy', () => {
  it('ad-free users see nothing', () => {
    expect(decideExportAd({ adFree: true, successfulExportsToday: 2, jobId: 'j', shownJobIds: new Set() })).toEqual({ placement: 'none' });
  });
  it('third daily export shows the interstitial instead of the export-wait ad (no doubling)', () => {
    expect(decideExportAd({ adFree: false, successfulExportsToday: 0, jobId: 'j', shownJobIds: new Set() })).toEqual({ placement: 'export-wait' });
    expect(decideExportAd({ adFree: false, successfulExportsToday: 2, jobId: 'j', shownJobIds: new Set() })).toEqual({ placement: 'daily-third-interstitial' });
  });
  it('retrying the same job does not show again', () => {
    expect(decideExportAd({ adFree: false, successfulExportsToday: 2, jobId: 'j', shownJobIds: new Set(['j']) })).toEqual({ placement: 'none' });
  });
});

describe('cloud config', () => {
  it('requires https URL and never accepts a service_role key', () => {
    expect(readCloudConfig({})).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_123' })).toEqual({ url: 'https://x.supabase.co', publishableKey: 'sb_publishable_123' });
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'service_role_abc' })).toBeNull();
  });
});

describe('noop services', () => {
  it('purchase is not available and ad-free is false', async () => {
    const p = new NoOpPurchaseService();
    expect(await p.hasAdFree()).toBe(false);
    expect((await p.purchaseAdFree()).status).toBe('not-available');
    const a = new NoOpAdService();
    expect(await a.show('export-wait', {})).toBe('disabled');
    const dev = new DevSimulatedAdService(true);
    let failed = '';
    dev.onFailure((pl) => (failed = pl));
    expect(await dev.show('export-wait', {})).toBe('failed');
    expect(failed).toBe('export-wait');
  });
});
