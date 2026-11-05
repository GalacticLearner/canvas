/** Validated board data and operation algebra; renderer and authority use the same model. */
import { z } from "zod";
import { LIMITS } from "./constants";
const coord = z.number().finite().min(-LIMITS.maxCoord).max(LIMITS.maxCoord);
/** All supported canvas primitives. */
export const elementTypes = [
  "stroke",
  "erase",
  "rect",
  "roundrect",
  "ellipse",
  "diamond",
  "triangle",
  "parallelogram",
  "hexagon",
  "line",
  "arrow",
  "text",
  "sticky",
  "image",
  "mindnode",
  "frame",
] as const;
/** Style defaults keep persisted boards portable across themes. */
export const defaultStyle = {
  stroke: "#243E36",
  fill: null as string | null,
  strokeWidth: 3,
  opacity: 1,
  dash: "solid" as const,
  fontSize: 20,
  bold: false,
  italic: false,
  align: "left" as const,
};
const color = z.string().regex(/^(#[0-9a-fA-F]{3,8}|transparent)$/);
/** Validated style properties. */
export const styleSchema = z
  .object({
    stroke: color,
    fill: color.nullable(),
    strokeWidth: z.number().min(1).max(40),
    opacity: z.number().min(0).max(1),
    dash: z.enum(["solid", "dashed", "dotted"]),
    fontSize: z.number().min(8).max(200).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  })
  .strict();
const bindSchema = z
  .object({
    elId: z.string().max(100),
    anchor: z.enum(["auto", "top", "right", "bottom", "left"]),
  })
  .strict();
/** Element fields remain flat to make property-level last-writer-wins explicit. */
export const elementSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .refine((id) => !["__proto__", "constructor", "prototype"].includes(id)),
    type: z.enum(elementTypes),
    x: coord,
    y: coord,
    w: coord.optional(),
    h: coord.optional(),
    angle: z.number().finite().optional(),
    z: z.string().min(1).max(100),
    authorId: z.string().max(100),
    authorName: z.string().max(24),
    createdAt: z.number(),
    updatedAt: z.number(),
    ver: z.number().int().nonnegative(),
    locked: z.boolean().optional(),
    groupId: z.string().max(100).nullable().optional(),
    frameId: z.string().max(100).nullable().optional(),
    style: styleSchema,
    points: z
      .array(coord)
      .max(LIMITS.maxPoints * 2)
      .refine(
        (points) => points.length % 2 === 0,
        "Points must be coordinate pairs",
      )
      .optional(),
    tool: z.enum(["pen", "highlighter"]).optional(),
    size: z.number().min(1).max(200).optional(),
    text: z.string().max(LIMITS.maxText).optional(),
    fontSize: z.number().min(8).max(200).optional(),
    route: z.enum(["straight", "elbow", "curve"]).optional(),
    startHead: z.enum(["none", "arrow", "dot", "diamond"]).optional(),
    endHead: z.enum(["none", "arrow", "dot", "diamond"]).optional(),
    start: bindSchema.nullable().optional(),
    end: bindSchema.nullable().optional(),
    color: z.string().max(30).optional(),
    assetId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    natW: z.number().positive().optional(),
    natH: z.number().positive().optional(),
    parentId: z.string().max(100).nullable().optional(),
    side: z.enum(["left", "right"]).optional(),
    collapsed: z.boolean().optional(),
    title: z.string().max(200).optional(),
  })
  .strict();
/** Serializable element. */
export type Element = z.infer<typeof elementSchema>;
/** Board state schema is bounded at import as well as during editing. */
export const boardSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    elements: z
      .record(z.string(), elementSchema)
      .refine((v) => Object.keys(v).length <= LIMITS.maxElements),
    frames: z.array(z.string().max(100)).max(LIMITS.maxElements),
  })
  .strict();
/** Authoritative sequence plus indexed elements. */
export type BoardState = z.infer<typeof boardSchema>;
/** Patch only changed element/style properties so concurrent gestures preserve unrelated fields. */
export type PatchSet = Omit<Partial<Element>, "style"> & {
  style?: Partial<Element["style"]>;
};
/** Operation algebra; batch nesting is validated with a depth budget by the reducer. */
export type Op =
  | { kind: "add"; el: Element }
  | { kind: "patch"; id: string; set: PatchSet }
  | { kind: "remove"; ids: string[] }
  | { kind: "batch"; ops: Op[] }
  | { kind: "clear" }
  | { kind: "replace_state"; state: BoardState }
  | { kind: "frames_order"; ids: string[] };
/** Recursive wire validation rejects unrecognized operation fields. */
export const opSchema: z.ZodType<Op> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("add"), el: elementSchema }).strict(),
    z
      .object({
        kind: z.literal("patch"),
        id: z.string().max(100),
        set: elementSchema
          .partial()
          .omit({
            id: true,
            authorId: true,
            authorName: true,
            createdAt: true,
            ver: true,
            updatedAt: true,
            type: true,
            style: true,
          })
          .extend({ style: styleSchema.partial().optional() }),
      })
      .strict(),
    z
      .object({
        kind: z.literal("remove"),
        ids: z.array(z.string().max(100)).max(50000),
      })
      .strict(),
    z
      .object({ kind: z.literal("batch"), ops: z.array(opSchema).max(50000) })
      .strict(),
    z.object({ kind: z.literal("clear") }).strict(),
    z.object({ kind: z.literal("replace_state"), state: boardSchema }).strict(),
    z
      .object({
        kind: z.literal("frames_order"),
        ids: z.array(z.string().max(100)).max(50000),
      })
      .strict(),
  ]),
);
/** Fresh boards never share a mutable elements dictionary. */
export const emptyBoard = (): BoardState => ({
  seq: 0,
  elements: {},
  frames: [],
});
/** Quantization caps freehand bandwidth independent of input precision. */
export const round1 = (n: number) => Math.round(n * 10) / 10;
/** Factory used for gestures and demo tooling, with authority fields overwritten on the server. */
export function makeElement(
  type: Element["type"],
  id: string,
  x = 0,
  y = 0,
): Element {
  return {
    id,
    type,
    x,
    y,
    w: 160,
    h: 100,
    z: "a0",
    authorId: "local",
    authorName: "You",
    createdAt: 0,
    updatedAt: 0,
    ver: 0,
    style: { ...defaultStyle },
  };
}
