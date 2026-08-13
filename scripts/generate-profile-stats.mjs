import fs from 'node:fs';

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_REPOSITORY_OWNER;

if (!token) throw new Error('GITHUB_TOKEN is required');
if (!login) throw new Error('GITHUB_REPOSITORY_OWNER is required');

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - 1);

const query = `
  query ProfileStats($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      repositories(
        first: 100
        privacy: PUBLIC
        ownerAffiliations: OWNER
        isFork: false
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name } }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }
`;

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'profile-stats-action'
  },
  body: JSON.stringify({
    query,
    variables: { login, from: from.toISOString(), to: now.toISOString() }
  })
});

if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
const payload = await response.json();
if (payload.errors?.length) throw new Error(JSON.stringify(payload.errors));

const user = payload.data?.user;
if (!user) throw new Error(`Could not resolve GitHub user ${login}`);

const collection = user.contributionsCollection;
const calendar = collection.contributionCalendar;
const repoNodes = user.repositories.nodes || [];

const days = calendar.weeks
  .flatMap((week) => week.contributionDays)
  .map((day) => ({ ...day, dateObj: new Date(`${day.date}T00:00:00Z`) }))
  .filter((day) => day.dateObj >= from && day.dateObj <= now)
  .sort((a, b) => a.dateObj - b.dateObj);

const languageBytes = new Map();
for (const repo of repoNodes) {
  for (const edge of repo.languages.edges) {
    languageBytes.set(edge.node.name, (languageBytes.get(edge.node.name) || 0) + edge.size);
  }
}

const languageEntries = [...languageBytes.entries()].sort((a, b) => b[1] - a[1]);
const languageTotal = languageEntries.reduce((sum, [, bytes]) => sum + bytes, 0);
const topLanguages = languageEntries.slice(0, 5).map(([name, bytes]) => ({
  name,
  percent: languageTotal ? Math.round((bytes / languageTotal) * 100) : 0
}));
while (topLanguages.length < 5) topLanguages.push({ name: '—', percent: 0 });

function streakStats(inputDays) {
  if (!inputDays.length) return { current: 0, longest: 0 };

  let longest = 0;
  let run = 0;
  for (const day of inputDays) {
    if (day.contributionCount > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  let i = inputDays.length - 1;
  if (inputDays[i]?.contributionCount === 0) i -= 1;

  let current = 0;
  while (i >= 0 && inputDays[i].contributionCount > 0) {
    current += 1;
    i -= 1;
  }
  return { current, longest };
}

function compact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

const { current, longest } = streakStats(days);
const totalContributions = calendar.totalContributions;
const repos = user.repositories.totalCount;
const commits = collection.totalCommitContributions;
const prs = collection.totalPullRequestContributions;
const issues = collection.totalIssueContributions;
const totalStars = repoNodes.reduce((sum, repo) => sum + repo.stargazerCount, 0);
const activeDays = days.filter((day) => day.contributionCount > 0).length;
const averagePerActiveDay = activeDays ? (totalContributions / activeDays).toFixed(1) : '0';
const topLanguage = topLanguages[0]?.name || '—';

const esc = (value) => String(value).replace(/[&<>\"]/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[ch]));

const lastWeeks = calendar.weeks.slice(-52);
const maxCount = Math.max(1, ...lastWeeks.flatMap((week) => week.contributionDays.map((day) => day.contributionCount)));
const levels = ['#deded9', '#bdbdb8', '#8b8b86', '#575754', '#111111'];
const cells = [];
const cell = 7;
const gap = 3;
const originX = 355;
const originY = 420;

lastWeeks.forEach((week, x) => {
  week.contributionDays.forEach((day, y) => {
    const ratio = day.contributionCount / maxCount;
    const level = day.contributionCount === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(ratio * 4)));
    cells.push(`<rect x="${originX + x * (cell + gap)}" y="${originY + y * (cell + gap)}" width="${cell}" height="${cell}" rx="1" fill="${levels[level]}"/>`);
  });
});

const overview = [
  ['REPOSITORIES', compact(repos), 'public · non-fork'],
  ['CONTRIBUTIONS', compact(totalContributions), 'last 12 months'],
  ['COMMITS', compact(commits), 'last 12 months'],
  ['PULL REQUESTS', compact(prs), 'last 12 months'],
  ['STARS', compact(totalStars), 'public repositories']
];

const overviewMarkup = overview.map(([label, value, sub], i) => {
  const x = 368 + i * 155;
  return `<g transform="translate(${x} 190)"><text class="label">${label}</text><text class="big" y="48">${value}</text><text class="sub" y="74">${sub}</text></g>`;
}).join('\n');

const languageMarkup = topLanguages.map((lang, i) => {
  const y = 650 + i * 26;
  const width = Math.max(0, Math.min(235, lang.percent * 2.35));
  return `<g><text class="body" x="365" y="${y}">${esc(lang.name)}</text><rect x="455" y="${y - 8}" width="235" height="7" rx="3.5" fill="#d8d8d3"/><rect x="455" y="${y - 8}" width="${width}" height="7" rx="3.5" fill="#222"/><text class="sub" x="700" y="${y}">${lang.percent}%</text></g>`;
}).join('\n');

const updated = now.toISOString().slice(0, 10);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820" role="img" aria-labelledby="title desc">
<title id="title">Live GitHub activity dashboard</title>
<desc id="desc">Automatically generated GitHub repository, contribution, commit, pull request, star, streak and language statistics for the last twelve months.</desc>
<style>
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .label { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; letter-spacing: 1px; fill: #222; }
  .sub { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; fill: #777773; }
  .body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; fill: #30302e; }
  .big { font-family: Arial, Helvetica, sans-serif; font-size: 30px; font-weight: 700; fill: #101010; }
  .mid { font-family: Arial, Helvetica, sans-serif; font-size: 42px; font-weight: 750; fill: #101010; }
  .card { fill: #f7f7f4; stroke: #bdbdb8; stroke-width: 1; }
</style>
<rect width="290" height="820" fill="#090909"/>
<rect x="290" width="910" height="820" fill="#f3f3f0"/>

<!-- architectural continuation -->
<path d="M0 0H290V820H0Z" fill="#0b0b0b"/>
<path d="M42 0H226L290 86V820H88L42 734Z" fill="#222"/>
<path d="M88 0H226V820H88Z" fill="#181818"/>
<g stroke="#6d6d6d" stroke-width="1" opacity=".5"><path d="M112 0V820M144 0V820M176 0V820M208 0V820"/><path d="M88 84H226M88 168H226M88 252H226M88 336H226M88 420H226M88 504H226M88 588H226M88 672H226M88 756H226"/></g>
<g fill="#c8c8c5" opacity=".28"><rect x="101" y="104" width="20" height="35"/><rect x="145" y="104" width="20" height="35"/><rect x="189" y="104" width="20" height="35"/><rect x="101" y="188" width="20" height="35"/><rect x="145" y="188" width="20" height="35"/><rect x="189" y="188" width="20" height="35"/><rect x="101" y="440" width="20" height="35"/><rect x="145" y="440" width="20" height="35"/><rect x="189" y="440" width="20" height="35"/></g>
<path d="M24 44V776M24 44H31M24 776H31" stroke="#d0d0cc"/>
<g transform="translate(28 744) rotate(-90)" class="mono" fill="#d0d0cc" font-size="11" letter-spacing="4"><text>ACTIVITY · SIGNAL · OUTPUT</text></g>

<circle cx="340" cy="45" r="4" fill="#111"/><text class="label" x="360" y="50">02 — ACTIVITY / LIVE</text><text class="sub" x="1055" y="50">${updated}</text><path d="M340 70H1148" stroke="#8f8f8b"/>
<text class="mid" x="340" y="122">ACTIVITY</text>

<rect class="card" x="340" y="145" width="808" height="140" rx="2"/>
<text class="label" x="365" y="172">GITHUB OVERVIEW</text>
${overviewMarkup}

<rect class="card" x="340" y="310" width="550" height="250" rx="2"/>
<text class="label" x="365" y="340">CONTRIBUTION GRAPH</text><text class="sub" x="365" y="358">last 52 weeks · ${compact(totalContributions)} contributions / 12m</text>
${cells.join('\n')}
<g class="sub"><text x="365" y="520">LESS</text><rect x="400" y="512" width="8" height="8" rx="1" fill="#deded9"/><rect x="412" y="512" width="8" height="8" rx="1" fill="#bdbdb8"/><rect x="424" y="512" width="8" height="8" rx="1" fill="#8b8b86"/><rect x="436" y="512" width="8" height="8" rx="1" fill="#575754"/><rect x="448" y="512" width="8" height="8" rx="1" fill="#111"/><text x="465" y="520">MORE</text></g>

<rect class="card" x="910" y="310" width="238" height="250" rx="2"/>
<text class="label" x="935" y="340">STREAK</text><text class="sub" x="935" y="358">consecutive active days</text>
<circle cx="1029" cy="423" r="45" fill="#ecece8" stroke="#c9c9c4"/><text class="mid" x="1029" y="437" text-anchor="middle">${current}</text><text class="label" x="1029" y="494" text-anchor="middle">CURRENT</text><text class="sub" x="1029" y="520" text-anchor="middle">longest ${longest} days / 12m</text>

<rect class="card" x="340" y="585" width="395" height="195" rx="2"/>
<text class="label" x="365" y="615">LANGUAGES</text><text class="sub" x="690" y="615" text-anchor="end">public repo bytes</text>
${languageMarkup}

<rect class="card" x="755" y="585" width="393" height="195" rx="2"/>
<text class="label" x="780" y="615">12M SIGNAL</text>
<g><text class="sub" x="780" y="652">ACTIVE DAYS</text><text class="big" x="780" y="687">${activeDays}</text></g>
<g><text class="sub" x="950" y="652">AVG / ACTIVE DAY</text><text class="big" x="950" y="687">${averagePerActiveDay}</text></g>
<path d="M780 712H1123" stroke="#d0d0cb"/>
<text class="sub" x="780" y="742">ISSUES / 12M</text><text class="body" x="880" y="742">${issues}</text><text class="sub" x="950" y="742">TOP LANGUAGE</text><text class="body" x="1123" y="742" text-anchor="end">${esc(topLanguage)}</text>
<text class="sub" x="340" y="808">source: GitHub GraphQL · generated ${updated}</text>
</svg>`;

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/profile-stats.svg', svg);
console.log(`Generated assets/profile-stats.svg for ${login}`);
