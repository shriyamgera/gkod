// Cable clip: a flat pad for tape or glue with an open ring that a cable snaps into.
// Drawn lying on its side, the way it should be printed, so the ring needs no supports.

// Cable diameter (mm)
cable_d = 6; // [3:0.5:12]
// Ring wall thickness (mm)
wall = 1.6; // [1.2:0.2:3]
// How much narrower the opening is than the cable (mm)
grip = 2; // [0.5:0.5:2.5]
// Clip length along the cable (mm)
length = 12; // [6:1:30]
// Pad width (mm)
pad_width = 20; // [10:1:40]
// Pad thickness (mm)
pad_thickness = 2; // [1.5:0.5:5]

/* [Hidden] */
$fn = 64;

outer_r = cable_d / 2 + wall;
// the opening is narrower than the cable, so the cable snaps in and stays in
slot = cable_d - grip;
ring_y = pad_thickness + outer_r - wall / 2;

module profile() {
  translate([-pad_width / 2, 0]) square([pad_width, pad_thickness]);
  difference() {
    translate([0, ring_y]) circle(r = outer_r);
    translate([0, ring_y]) circle(d = cable_d);
    translate([-slot / 2, ring_y]) square([slot, outer_r + 1]);
  }
}

linear_extrude(length) profile();
