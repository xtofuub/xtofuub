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
      repositories(first: 100, privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false) {
        totalCount
        nodes {
          languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
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
const days = calendar.weeks.flatMap((week) => week.contributionDays)
  .map((day) => ({ ...day, dateObj: new Date(`${day.date}T00:00:00Z`) }))
  .filter((day) => day.dateObj >= from && day.dateObj <= now)
  .sort((a, b) => a.dateObj - b.dateObj);

const languageBytes = new Map();
for (const repo of user.repositories.nodes) {
  for (const edge of repo.languages.edges) {
    languageBytes.set(edge.node.name, (languageBytes.get(edge.node.name) || 0) + edge.size);
  }
}
const topLanguage = [...languageBytes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

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
  const today = inputDays[i];
  if (today?.contributionCount === 0) i -= 1;

  let current = 0;
  while (i >= 0 && inputDays[i].contributionCount > 0) {
    current += 1;
    i -= 1;
  }
  return { current, longest };
}

const { current, longest } = streakStats(days);
const totalContributions = calendar.totalContributions;
const repos = user.repositories.totalCount;
const commits = collection.totalCommitContributions;
const prs = collection.totalPullRequestContributions;

const lastWeeks = calendar.weeks.slice(-52);
const maxCount = Math.max(1, ...lastWeeks.flatMap((week) => week.contributionDays.map((day) => day.contributionCount)));
const levels = ['#171717', '#444444', '#777777', '#b7b7b7', '#f2f2f2'];
const cells = [];
const cell = 8;
const gap = 4;
const originX = 42;
const originY = 244;

lastWeeks.forEach((week, x) => {
  week.contributionDays.forEach((day, y) => {
    const ratio = day.contributionCount / maxCount;
    const level = day.contributionCount === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(ratio * 4)));
    cells.push(`<rect x="${originX + x * (cell + gap)}" y="${originY + y * (cell + gap)}" width="${cell}" height="${cell}" rx="1" fill="${levels[level]}"/>`);
  });
});

const esc = (value) => String(value).replace(/[&<>\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const updated = now.toISOString().slice(0, 10);

const stat = (x, label, value, sub = '') => `
  <g transform="translate(${x} 70)">
    <text class="label" x="0" y="0">${esc(label)}</text>
    <text class="value" x="0" y="48">${esc(value)}</text>
    ${sub ? `<text class="sub" x="0" y="76">${esc(sub)}</text>` : ''}
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360" role="img" aria-labelledby="title desc">
<title id="title">Live GitHub activity</title>
<desc id="desc">Automatically updated GitHub repository, contribution, streak, language, commit and pull request statistics.</desc>
<style>
  .bg { fill: #070707; }
  .line { stroke: #2a2a2a; stroke-width: 1; }
  .label, .sub, .micro { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; fill: #8c8c8c; letter-spacing: 1.5px; }
  .label { font-size: 12px; }
  .sub { font-size: 11px; letter-spacing: .5px; }
  .micro { font-size: 11px; letter-spacing: .6px; }
  .value { font-family: Arial, Helvetica, sans-serif; font-size: 34px; font-weight: 700; fill: #f3f3f3; letter-spacing: -1px; }
</style>
<rect class="bg" width="1200" height="360" rx="2"/>
<path class="line" d="M30 34H1170M30 202H1170M30 334H1170"/>
<text class="micro" x="42" y="58">GITHUB / LIVE ACTIVITY</text>
<text class="micro" x="1040" y="58">UPDATED ${updated}</text>
${stat(42, 'REPOSITORIES', repos, 'public · non-fork')}
${stat(322, 'CONTRIBUTIONS / 12M', totalContributions, `${commits} commits · ${prs} PRs`)}
${stat(650, 'CURRENT STREAK', `${current}d`, `longest ${longest}d / 12m`)}
${stat(922, 'TOP LANGUAGE', topLanguage, 'weighted by public repo bytes')}
<text class="micro" x="42" y="226">CONTRIBUTION ACTIVITY / LAST 52 WEEKS</text>
${cells.join('\n')}
<text class="micro" x="730" y="266">This panel is generated automatically from GitHub.</text>
<text class="micro" x="730" y="288">No manually-entered profile details are included.</text>
<text class="micro" x="730" y="310">schedule: daily · source: GitHub GraphQL API</text>
</svg>`;

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/profile-stats.svg', svg);
console.log(`Generated assets/profile-stats.svg for ${login}`);
