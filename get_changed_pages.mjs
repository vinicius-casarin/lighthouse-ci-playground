import { existsSync, lstatSync } from 'fs'
import { readFile, readdir, writeFile } from 'fs/promises'

/**
 * Default values for dynamic route segments
 */
const placeholders = {
  category: 'technology',
}

const whitelistedExtensions = ['ts', 'tsx', 'js', 'jsx', 'json']

function getExamplePage(file) {
  for (const placeholder of Object.keys(placeholders)) {
    file = file.replace(`[${placeholder}]`, placeholders[placeholder])
  }
  return file
}

function cleanFileName(name) {
  return name.replace(/\.tsx?$/, '').replace(/^.\//, '')
}

async function findDependentPages(file, visited = new Set()) {
  const searchString = cleanFileName(
    file.substring(file.lastIndexOf('/'), file.length)
  )

  visited.add(file)

  const dependentFiles = (
    await Promise.all(
      [
        './app',
        './pages',
        './components',
        // ...
      ].map((path) => searchFor(path, searchString))
    )
  )
    .flat()
    .filter((page) => !visited.has(page))

  let dependentPages = new Set(dependentFiles)
  let stack = [...dependentFiles]

  while (stack.length > 0) {
    const item = stack.shift()
    const pages = await findDependentPages(item, visited)
    stack.push(...pages)
    Array.from(pages).forEach((page) => dependentPages.add(page))
  }

  return dependentPages
}

async function searchFor(file, keyword) {
  if (existsSync(file)) {
    const stats = lstatSync(file)
    if (stats.isDirectory()) {
      return (
        await Promise.all(
          (
            await readdir(file)
          ).map((item) => searchFor(file + '/' + item, keyword))
        )
      ).flat()
    } else if (
      stats.isFile() &&
      whitelistedExtensions.includes(file.substring(file.lastIndexOf('.') + 1))
    ) {
      const str = (await readFile(file)).toString()
      if (
        str
          .split('\n')
          .some((line) => line.includes('import') && line.includes(keyword))
      ) {
        return [file]
      }
    }
  }
  return []
}

let changedFiles = process?.argv[2]?.split(',')
let pagesToCheck = []

if (changedFiles) {
  for (const file of changedFiles) {
    if (!file.startsWith('src/app/') || !file.endsWith('page.tsx')) {
      const dependentPages = Array.from(await findDependentPages(file))
      pagesToCheck.push(
        ...dependentPages.filter((page) => page.endsWith('page.tsx'))
      )
    } else {
      pagesToCheck.push(file)
    }
  }
}

pagesToCheck = pagesToCheck
  // Make sure all pages exist
  .filter((it) => existsSync(it))
  // Remove file extension and leading "./"
  .map((page) => cleanFileName(page))
  .filter(
    (it) =>
      it.startsWith('src/app/') && // Include only Next.js pages
      !it.startsWith('src/app/api')
  )
  .map(
    (page) =>
      'http://localhost:3000' + // Prepend the host and port
      // Fill dynamic route segments with sample values
      // and remove parts of the file path with aren't included in the URL
      getExamplePage(page.replace('/page', '').replace(/^src\/app/, ''))
  )
  .sort()

// Remove duplicates
pagesToCheck = [...new Set(pagesToCheck)]

if (pagesToCheck.length === 0) {
  console.warn(
    'No changed pages found! Only the homepage will be included in the Lighthouse CI report.'
  )
  pagesToCheck = ['http://localhost:3000']
}

console.log('Pages to check:', pagesToCheck)

// Rewrite the Lighthouse config
let lhciConfig = JSON.parse((await readFile('lighthouserc.json')).toString())
lhciConfig.ci.collect.url = pagesToCheck
await writeFile('lighthouserc.json', JSON.stringify(lhciConfig, null, 2))
