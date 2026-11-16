export const previewExamples = [
  { name: '24.76 km northbound · includes straight-road section', query: '?t=TA&p=V&dt=20261205T0800&s=175.631794,-40.310686&e=175.445552,-40.185459', kilometers: 24.7621 },
  { name: '30.08 km northbound · Voyager', query: '?t=TA&p=V&dt=20261206T0800&s=169.133351,-44.659392&e=169.356974,-44.573907', kilometers: 30.0828 },
  { name: '22.01 km northbound · Far Point Trail', query: '?t=TA&p=F&dt=20261207T0800&s=172.460770,-42.461725&e=172.583853,-42.339319', kilometers: 22.0052 },
  { name: 'Gap crossing · should fail', query: '?t=TA&p=V&dt=20261208T0800&s=174.770876,-41.343986&e=174.235252,-41.094737', error: 'TRAIL_GAP' },
  { name: 'Off trail · should fail', query: '?t=TA&p=V&dt=20261208T0800&s=0,0&e=172.583853,-42.339319', error: 'OFF_TRAIL' },
] as const;
