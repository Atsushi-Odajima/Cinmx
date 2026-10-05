import { getDB, AssetStore, ProjectStore, LocalTemplateStore, ExportStore, SettingsStore } from '@cinemix/storage';
import { WebShareAdapter, NoOpAdService, DevSimulatedAdService, NoOpPurchaseService, readCloudConfig, CloudClient, CloudTemplateRepository, type AdService } from '@cinemix/platform';
import { WebMediaAdapter, WebRenderAdapter } from '@cinemix/render-web';

/** アプリ全体で共有する実装（Capacitor 移行時はここを差し替える） */
const db = getDB();
export const assetStore = new AssetStore(db);
export const projectStore = new ProjectStore(db);
export const localTemplateStore = new LocalTemplateStore(db);
export const exportStore = new ExportStore(db);
export const settingsStore = new SettingsStore(db);
export const loadBlob = (id: string) => assetStore.getBlob(id);
export const mediaAdapter = new WebMediaAdapter(assetStore);
export const renderAdapter = new WebRenderAdapter(loadBlob);
export const shareAdapter = new WebShareAdapter();
export const purchaseService = new NoOpPurchaseService();

const devAds = import.meta.env.DEV && import.meta.env.VITE_DEV_ADS === '1';
export const adService: AdService = devAds ? new DevSimulatedAdService(false) : new NoOpAdService();

export const cloudConfig = readCloudConfig(import.meta.env as unknown as Record<string, string | undefined>);
export const cloudClient = cloudConfig ? new CloudClient(cloudConfig) : null;
export const cloudTemplates = cloudClient ? new CloudTemplateRepository(cloudClient) : null;
export const isCloudConfigured = !!cloudClient;
