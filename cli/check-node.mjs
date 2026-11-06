// Runs before `npm start`. Older Node versions fail with a confusing error about
// the .ts file extension, so say what is actually wrong instead.
const [major, minor] = process.versions.node.split('.').map(Number)

if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`dialdesk needs Node 22.18 or newer. You have ${process.versions.node}.`)
  console.error('Install the current LTS from https://nodejs.org, then run npm start again.')
  process.exit(1)
}
