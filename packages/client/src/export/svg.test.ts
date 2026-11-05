/** SVG exports preserve shared connector geometry and escape user-controlled text. */
import { it, expect } from "vitest";
import { boardSvg } from "./svg";
import { emptyBoard, makeElement } from "../../../shared/src/index";
it("serializes arrowheads, actual polygons and safe text", () => {
  const state = emptyBoard();
  const shape = makeElement("triangle", "shape");
  shape.text = "<script>&";
  state.elements.shape = shape;
  const arrow = makeElement("arrow", "arrow");
  arrow.points = [1, 2, 100, 200];
  arrow.end = { elId: "shape", anchor: "right" };
  arrow.z = "a1";
  state.elements.arrow = arrow;
  const svg = boardSvg(state, { x: 0, y: 0, w: 600, h: 400 }, new Map());
  expect(svg).toContain("<polygon");
  expect(svg).toContain("&lt;script&gt;&amp;");
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("stroke-linecap");
});
it('emits one width attribute for highlighters and suppresses collapsed descendants',()=>{
 const state=emptyBoard(),stroke=makeElement('stroke','ink'),root=makeElement('mindnode','root'),child=makeElement('mindnode','child');
 stroke.points=[0,0,10,10];stroke.tool='highlighter';root.collapsed=true;child.parentId=root.id;child.text='hidden child';state.elements={ink:stroke,root,child};
 const svg=boardSvg(state,{x:0,y:0,w:100,h:100},new Map());
 expect(svg.match(/<path[^>]+>/)?.[0].match(/stroke-width=/g)).toHaveLength(1);
 expect(svg).not.toContain('hidden child');
});
