alter table public.project_activities
  add column if not exists text_description text;

update public.project_activities
set text_description = left(
  concat_ws(
    E'\n\n',
    $lorem$Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur vitae mauris at neque tincidunt dictum. Integer accumsan, sapien quis facilisis pretium, arcu mauris tempor ipsum, vitae viverra justo magna non velit. Sed non sem euismod, vehicula lectus sed, aliquet neque. Donec luctus, nisl at posuere commodo, metus justo ultrices ligula, vitae pulvinar nunc libero at est. Praesent commodo augue sit amet mi varius, sed dictum nibh hendrerit.$lorem$,
    $lorem$Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Aliquam erat volutpat. Nulla facilisi. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. "Quoted trail notes" and single-quoted observations can live here safely because this text is stored as data, not HTML. Suspendisse potenti. Aenean fermentum, risus vitae posuere suscipit, arcu lacus dignissim augue, id convallis urna magna in arcu.$lorem$,
    $lorem$Morbi finibus magna id velit tincidunt, a posuere justo luctus. Nam ullamcorper, nisl vel tincidunt consequat, massa erat pharetra justo, at dictum quam velit nec neque. Donec sed augue ac sapien facilisis interdum. Etiam consequat, ipsum at aliquet tincidunt, lectus risus porttitor orci, non malesuada lectus urna id turpis. Vivamus feugiat, eros a ullamcorper gravida, mi arcu blandit magna, vel varius mi mauris sed lacus.$lorem$
  ),
  1000
)
where text_description is null
   or btrim(text_description) = '';
