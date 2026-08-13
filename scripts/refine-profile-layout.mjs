import fs from 'node:fs';

const file = 'assets/profile-stats.svg';
let svg = fs.readFileSync(file, 'utf8');

const defs = `<defs>
<linearGradient id="railSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1a1a"/><stop offset=".55" stop-color="#0d0d0d"/><stop offset="1" stop-color="#050505"/></linearGradient>
<linearGradient id="railConcrete" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d0d0cd"/><stop offset=".42" stop-color="#a1a19e"/><stop offset="1" stop-color="#60605e"/></linearGradient>
<filter id="railGrain" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".82" numOctaves="3" seed="13"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .14"/></feComponentTransfer></filter>
<clipPath id="railFace"><path d="M94 118L214 152L214 820H72L80 246Z"/></clipPath>
</defs>`;

if (!svg.includes('id="railSky"')) svg = svg.replace('</style>', `</style>${defs}`);

const rail = `<rect width="290" height="820" fill="url(#railSky)"/>
<rect x="290" width="910" height="820" fill="#f3f3f0"/>
<rect width="290" height="820" filter="url(#railGrain)" opacity=".27"/>
<path d="M0 820V226L87 145L96 111L215 142L290 235V820Z" fill="#070707"/>
<path d="M0 226L87 145L96 111L215 142L290 235L282 249L207 171L108 143L95 233L0 299Z" fill="#0e0e0e"/>
<path d="M88 149L100 115L215 145L282 236L274 243L206 171L105 144L96 159Z" fill="#ecece8"/>
<path d="M94 118L214 152L214 820H72L80 246Z" fill="url(#railConcrete)"/>
<path d="M214 152L290 242V820H214Z" fill="#090909"/>
<path d="M72 820L80 246L94 118L106 144L98 260L94 820Z" fill="#222" opacity=".5"/>
<path d="M101 336L173 356V517L98 498Z" fill="#0b0b0b"/>
<g opacity=".67" stroke="#4b4b49"><path d="M110 339V501"/><path d="M122 342V504"/><path d="M134 346V507"/><path d="M146 349V510"/><path d="M158 352V513"/></g>
<g clip-path="url(#railFace)" stroke="#686865" stroke-width=".6" opacity=".4"><path d="M86 208L214 242"/><path d="M82 281L214 314"/><path d="M80 354L214 386"/><path d="M78 427L214 458"/><path d="M77 500L214 530"/><path d="M76 573L214 602"/><path d="M74 646L214 674"/><path d="M73 719L214 746"/><path d="M122 124L106 820"/><path d="M164 136L158 820"/></g>
<rect x="72" y="112" width="148" height="708" filter="url(#railGrain)" opacity=".16" clip-path="url(#railFace)"/>
<path d="M24 32V780M24 32H31M24 780H31" stroke="#e0e0dc"/>
<circle cx="24" cy="132" r="4" fill="none" stroke="#e0e0dc"/><path d="M17 132H31M24 125V139" stroke="#e0e0dc" opacity=".8"/>
<g transform="translate(30 765) rotate(-90)" class="mono" fill="#d8d8d4" font-size="10" letter-spacing="4"><text>ACTIVITY · SIGNAL · OUTPUT</text></g>`;

svg = svg.replace(/<rect width="290"[\s\S]*?<circle cx="340"/, `${rail}\n<circle cx="340"`);
fs.writeFileSync(file, svg);
