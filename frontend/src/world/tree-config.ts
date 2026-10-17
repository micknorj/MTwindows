// Shared with workers: proportions and placement species do not depend on Three.js.
export const TREE_KINDS = ['conifer', 'pine', 'broadleaf', 'birch'] as const;
export type TreeKind = typeof TREE_KINDS[number];
export function treeHeroDistance(height:number,scale=1,budget=1){return budget*Math.max(35,Math.min(70,height*3.4*scale));}
export function treeMiddleDistance(height:number,scale=1,budget=1){return budget*Math.max(240,Math.min(420,height*18*scale));}
export const TREE_PROPORTIONS = { conifer: .43, pine: .6, broadleaf: 1, birch: .52 } satisfies Record<TreeKind, number>;
