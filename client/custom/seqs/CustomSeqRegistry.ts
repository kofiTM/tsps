/**
 * Custom sequences (animations) sent by the server's "customSeqs" dataset
 * (server/data/definitions/custom-seqs.json): each one is a clone of a cache sequence (`template`)
 * with its own frames. A frame is the cache's own frame format (Dat2SeqFrame: frame base id, flags,
 * smart values), base64, so the client decodes it exactly as a cache frame.
 *
 * Custom frame ids live in their own frame group (CUSTOM_FRAME_GROUP << 16 | n), one the cache's
 * animation index never uses.
 *
 * A row with `kind: "base"` is a custom frame base (skeleton) instead: `data` is the cache's own
 * frame base format (Dat2SeqBase), `id` is the base id frames name in their header (65000+, past the
 * cache's skeletons). `rotationDivisor` > 1 marks a fine-rotation skeleton (RS3 ports, which use
 * 16384 steps per turn): its frames' rotation values are divided by it, giving fractional OSRS
 * angles (256 per turn) that the client's fractional animation path uses as they are.
 */
export interface CustomSeqBaseRow {
    kind: "base";
    id: number;
    data: string;
    rotationDivisor?: number;
}
export interface CustomSeqRow {
    id: number;
    template: number;
    frameLengths: number[];
    frames: string[];
}

export const CUSTOM_FRAME_GROUP = 0x7fff;

function decodeBase64(text: string): Int8Array {
    const binary = typeof atob === "function" ? atob(text) : Buffer.from(text, "base64").toString("binary");
    const out = new Int8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) << 24 >> 24;
    return out;
}

export class CustomSeqRegistry {
    static revision = 0;
    private static readonly rows = new Map<number, { row: CustomSeqRow; frameIds: number[] }>();
    private static readonly frames = new Map<number, Int8Array>();
    private static nextFrame = 0;
    private static readonly bases = new Map<number, { data: Int8Array; rotationDivisor: number }>();

    static clear(): void {
        this.rows.clear();
        this.bases.clear();
        this.frames.clear();
        this.nextFrame = 0;
        this.revision++;
    }

    static register(row: CustomSeqRow | CustomSeqBaseRow): void {
        if ((row as CustomSeqBaseRow)?.kind === "base") {
            const base = row as CustomSeqBaseRow;
            if (!Number.isInteger(base.id) || typeof base.data !== "string") return;
            const divisor = Number(base.rotationDivisor);
            this.bases.set(base.id, { data: decodeBase64(base.data), rotationDivisor: divisor > 1 ? divisor : 1 });
            this.revision++;
            return;
        }
        row = row as CustomSeqRow;
        if (!row || !Number.isInteger(row.id) || !Number.isInteger(row.template) || !Array.isArray(row.frames)) return;
        if (row.frames.length !== row.frameLengths?.length) return;
        const frameIds: number[] = [];
        for (const frame of row.frames) {
            const id = (CUSTOM_FRAME_GROUP << 16) | this.nextFrame++;
            this.frames.set(id, decodeBase64(frame));
            frameIds.push(id);
        }
        this.rows.set(row.id, { row, frameIds });
        this.revision++;
    }

    static get(id: number): { row: CustomSeqRow; frameIds: number[] } | undefined {
        return this.rows.get(id);
    }

    static base(id: number): { data: Int8Array; rotationDivisor: number } | undefined {
        return this.bases.get(id);
    }

    static frame(id: number): Int8Array | undefined {
        return this.frames.get(id);
    }

    static maxId(): number {
        let max = -1;
        for (const id of this.rows.keys()) if (id > max) max = id;
        return max;
    }
}
