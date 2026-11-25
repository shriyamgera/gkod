// Mounting plate with 40 holes made in a loop (8 x 5 grid).
cols = 8;
rows = 5;
pitch = 12;
hole_d = 4.2;
plate_t = 4;
margin = 8;
$fn = 32;

plate_w = (cols - 1) * pitch + 2 * margin;
plate_h = (rows - 1) * pitch + 2 * margin;

difference() {
  cube([plate_w, plate_h, plate_t]);
  for (i = [0 : cols - 1])
    for (j = [0 : rows - 1])
      translate([margin + i * pitch, margin + j * pitch, -1])
        cylinder(d = hole_d, h = plate_t + 2);
}
