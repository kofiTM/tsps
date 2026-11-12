import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { SeqType } from "../../rs/config/seqtype/SeqType";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { Dat2SeqBase, type SeqBase } from "../../rs/model/seq/SeqBase";
import type { SeqBaseLoader } from "../../rs/model/seq/SeqBaseLoader";
import { SeqTransformType } from "../../rs/model/seq/SeqTransformType";
import { Dat2SeqFrame, SeqFrame } from "../../rs/model/seq/SeqFrame";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { CUSTOM_FRAME_GROUP, CustomSeqRegistry } from "./CustomSeqRegistry";

/** Resolves custom sequence ids: a clone of the template sequence with the custom frames. */
export class CustomSeqTypeLoader implements SeqTypeLoader {
    private readonly customCache = new Map<number, SeqType>();
    private revision = -1;

    constructor(private readonly base: SeqTypeLoader) {}

    load(id: number): SeqType {
        const entry = CustomSeqRegistry.get(id);
        if (!entry) return this.base.load(id);
        if (this.revision !== CustomSeqRegistry.revision) {
            this.customCache.clear();
            this.revision = CustomSeqRegistry.revision;
        }
        const cached = this.customCache.get(id);
        if (cached) return cached;
        const template = this.base.load(entry.row.template);
        const clone = Object.assign(Object.create(Object.getPrototypeOf(template)), template) as SeqType;
        (clone as { id: number }).id = id | 0;
        clone.frameIds = [...entry.frameIds];
        clone.frameLengths = [...entry.row.frameLengths];
        // The template's sounds are keyed to its own frames: a custom sequence's are the server's.
        clone.frameSounds = undefined;
        this.customCache.set(id, clone);
        return clone;
    }

    getCount(): number {
        return Math.max(this.base.getCount(), CustomSeqRegistry.maxId() + 1);
    }

    clearCache(): void {
        this.customCache.clear();
        this.base.clearCache();
    }
}

/** Resolves custom frame ids (CUSTOM_FRAME_GROUP) from the registry, decoded as cache frames. */
export class CustomSeqFrameLoader implements SeqFrameLoader {
    private readonly customCache = new Map<number, SeqFrame>();
    private revision = -1;

    constructor(
        private readonly base: SeqFrameLoader,
        private readonly cacheInfo: CacheInfo,
        private readonly baseLoader: SeqBaseLoader,
    ) {}

    load(id: number): SeqFrame | undefined {
        if (id >>> 16 !== CUSTOM_FRAME_GROUP) return this.base.load(id);
        if (this.revision !== CustomSeqRegistry.revision) {
            this.customCache.clear();
            this.revision = CustomSeqRegistry.revision;
        }
        const cached = this.customCache.get(id);
        if (cached) return cached;
        const data = CustomSeqRegistry.frame(id);
        if (!data) return undefined;
        const frame = Dat2SeqFrame.load(this.cacheInfo, this.baseLoader, data);
        // Fine-rotation skeletons (RS3 ports): rotation values become fractional OSRS angles.
        const divisor = CustomSeqRegistry.base(frame.base.id)?.rotationDivisor ?? 1;
        if (divisor > 1) {
            for (let i = 0; i < frame.transformCount; i++) {
                if (frame.base.types[frame.transformGroups[i]] !== SeqTransformType.ROTATE) continue;
                frame.transformX[i] /= divisor;
                frame.transformY[i] /= divisor;
                frame.transformZ[i] /= divisor;
            }
        }
        this.customCache.set(id, frame);
        return frame;
    }

    clearCache(): void {
        this.customCache.clear();
        this.base.clearCache();
    }
}

/** Resolves custom frame bases (skeletons) from the registry: the cache's own bases otherwise. */
export class CustomSeqBaseLoader implements SeqBaseLoader {
    private readonly customCache = new Map<number, SeqBase>();
    private revision = -1;

    constructor(
        private readonly base: SeqBaseLoader,
        private readonly cacheInfo: CacheInfo,
    ) {}

    load(id: number): SeqBase | undefined {
        const entry = CustomSeqRegistry.base(id);
        if (!entry) return this.base.load(id);
        if (this.revision !== CustomSeqRegistry.revision) {
            this.customCache.clear();
            this.revision = CustomSeqRegistry.revision;
        }
        const cached = this.customCache.get(id);
        if (cached) return cached;
        const base = Dat2SeqBase.load(this.cacheInfo, id, entry.data);
        this.customCache.set(id, base);
        return base;
    }

    clearCache(): void {
        this.customCache.clear();
        this.base.clearCache();
    }
}
