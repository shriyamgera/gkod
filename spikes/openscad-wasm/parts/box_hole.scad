// Simple box with a through hole.
size = [40, 30, 12];
hole_d = 8;
$fn = 48;

difference() {
  cube(size, center = true);
  cylinder(d = hole_d, h = size[2] + 2, center = true);
}
