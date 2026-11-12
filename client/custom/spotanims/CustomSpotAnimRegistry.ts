/**
 * Server-defined spot animations (projectiles / graphics) built from a cache spot animation
 * with its model swapped for a custom model (custom/items/CustomModelRegistry), e.g. Vorago's
 * bombs ported from RS3. Sent at login as the "customSpotAnims" dataset.
 */
/** `widthScale` / `heightScale` (128 = the model's own size) replace the base's when given. */
export type CustomSpotAnimRow = { id: number; baseId: number; modelId: number; widthScale?: number; heightScale?: number };

const rows = new Map<number, CustomSpotAnimRow>();

export const CustomSpotAnimRegistry = {
    revision: 0,
    register(row: CustomSpotAnimRow): void {
        if (!Number.isInteger(row?.id) || !Number.isInteger(row?.baseId) || !Number.isInteger(row?.modelId)) {
            throw new Error("Invalid custom spot animation");
        }
        const scale = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) | 0 : undefined);
        rows.set(row.id | 0, {
            id: row.id | 0, baseId: row.baseId | 0, modelId: row.modelId | 0,
            widthScale: scale(row.widthScale), heightScale: scale(row.heightScale),
        });
        this.revision++;
    },
    get(id: number): CustomSpotAnimRow | undefined { return rows.get(id | 0); },
    maxId(): number { let max = -1; for (const id of rows.keys()) max = Math.max(max, id); return max; },
    clear(): void { rows.clear(); this.revision++; },
};
