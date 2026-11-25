// Program-made training-style parts: fixed OpenSCAD templates + sizes from a seeded RNG.
export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ri = (r, lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
export const TEMPLATES = {
  simple: (r) => `size=[${ri(r, 20, 80)},${ri(r, 20, 60)},${ri(r, 5, 30)}]; hole_d=${ri(r, 3, 12)}; $fn=48;
difference(){ cube(size, center=true); cylinder(d=hole_d, h=size[2]+2, center=true); }`,
  plate: (r) => `cols=${ri(r, 2, 8)}; rows=${ri(r, 2, 5)}; pitch=${ri(r, 8, 16)}; hole_d=${ri(r, 2, 5)}; t=${ri(r, 2, 6)}; m=8; $fn=32;
difference(){ cube([(cols-1)*pitch+2*m,(rows-1)*pitch+2*m,t]);
 for(i=[0:cols-1]) for(j=[0:rows-1]) translate([m+i*pitch,m+j*pitch,-1]) cylinder(d=hole_d,h=t+2); }`,
  rounded: (r) => `l=${ri(r, 40, 120)}; w=${ri(r, 30, 80)}; h=${ri(r, 15, 50)}; rr=${ri(r, 2, 6)}; wall=${ri(r, 2, 3)}; $fn=24;
module rb(l,w,h,r){ hull() for(x=[r,l-r],y=[r,w-r],z=[r,h-r]) translate([x,y,z]) sphere(r=r); }
difference(){ rb(l,w,h,rr); translate([wall,wall,wall]) rb(l-2*wall,w-2*wall,h,max(rr-wall,0.5)); }`,
  bracket: (r) => `a=${ri(r, 30, 70)}; b=${ri(r, 30, 70)}; w=${ri(r, 15, 40)}; t=${ri(r, 3, 6)}; d=${ri(r, 3, 6)}; n=${ri(r, 1, 3)}; $fn=32;
difference(){ union(){ cube([a,w,t]); cube([t,w,b]); hull(){ translate([t,0,t]) cube([a/3,t,0.01]); translate([t,0,t]) cube([0.01,t,b/3]); } }
 for(i=[1:n]) translate([t+i*(a-t)/(n+1), w/2, -1]) cylinder(d=d,h=t+2);
 for(i=[1:n]) translate([-1, w/2, t+i*(b-t)/(n+1)]) rotate([0,90,0]) cylinder(d=d,h=t+2); }`,
};

