import type { CinemixDB, ExportRow } from './db';
import { toStorageError } from './errors';

/** 直近の書き出し結果を下書きごとに1件保持する（再読み込み後も再生・共有できる） */
export class ExportStore {
  constructor(private readonly db: CinemixDB) {}
  async put(row: ExportRow): Promise<void> {
    try {
      await this.db.exports.put(row);
    } catch (e) {
      throw toStorageError(e, '書き出した動画の保存に失敗しました（動画自体は共有できます）');
    }
  }
  async get(projectId: string): Promise<ExportRow | undefined> {
    return this.db.exports.get(projectId);
  }
  async delete(projectId: string): Promise<void> {
    await this.db.exports.delete(projectId);
  }
}
