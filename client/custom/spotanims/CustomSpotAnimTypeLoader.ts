import type { SpotAnimType } from "../../rs/config/spotanimtype/SpotAnimType";
import type { SpotAnimTypeLoader } from "../../rs/config/spotanimtype/SpotAnimTypeLoader";
import { CustomSpotAnimRegistry } from "./CustomSpotAnimRegistry";

/** Resolves custom spot animation ids: a clone of the base type with the model (and, when given, its size) replaced. */
export class CustomSpotAnimTypeLoader implements SpotAnimTypeLoader {
    private readonly customCache = new Map<number, SpotAnimType>();
    private revision = -1;

    constructor(private readonly base: SpotAnimTypeLoader) {}

    load(id: number): SpotAnimType {
        const row = CustomSpotAnimRegistry.get(id);
        if (!row) return this.base.load(id);
        if (this.revision !== CustomSpotAnimRegistry.revision) {
            this.customCache.clear();
            this.revision = CustomSpotAnimRegistry.revision;
        }
        const cached = this.customCache.get(id);
        if (cached) return cached;
        const baseType = this.base.load(row.baseId);
        const clone = Object.assign(Object.create(Object.getPrototypeOf(baseType)), baseType) as SpotAnimType;
        clone.modelId = row.modelId;
        if (row.widthScale !== undefined) clone.widthScale = row.widthScale;
        if (row.heightScale !== undefined) clone.heightScale = row.heightScale;
        (clone as { id: number }).id = id | 0;
        this.customCache.set(id, clone);
        return clone;
    }

    getCount(): number {
        return Math.max(this.base.getCount(), CustomSpotAnimRegistry.maxId() + 1);
    }

    clearCache(): void {
        this.customCache.clear();
        this.base.clearCache();
    }
}
