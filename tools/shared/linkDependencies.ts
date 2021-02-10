import { createProjectGraph, ProjectGraph } from '@nrwl/workspace/src/core/project-graph'
import * as fs from 'fs'
import { promisify } from 'util'
import mkdirp from 'mkdirp'
import * as path from 'path'
import { flatten, uniq } from 'lodash'

const { npmScope } = JSON.parse(fs.readFileSync(path.resolve('nx.json'), 'utf-8'))
export default async (pkgName: string, flatten: boolean) => {
  const dependencyGraph = createProjectGraph()
  const resolvedDependencies = resolveDependenciesRecursive(pkgName, dependencyGraph.dependencies)

  if (flatten) {
    await link(
      pkgName,
      flattenDependencies(resolvedDependencies),
      dependencyGraph
    )
  } else {
    await linkRecursive(resolvedDependencies, dependencyGraph)
  }
}

const link = async (pkgName: string, dependencies: string[], dependencyGraph: ProjectGraph) => {
  const localNodeModulesPath = path.resolve('dist', dependencyGraph.nodes[pkgName].data.root, 'node_modules')
    await mkdirp(localNodeModulesPath)

    await Promise.all(dependencies.map(async (pkgName) => {
      const node = dependencyGraph.nodes[pkgName]

      const sourcePath = path.resolve('dist', node.data.root)
      const targetPath = path.join(localNodeModulesPath, `@${npmScope}`, pkgName)
      console.log(`linking ${sourcePath} -> ${targetPath}`)

      await mkdirp(sourcePath)
      await mkdirp(path.join(targetPath, '..'))
      
      await symlink(sourcePath, targetPath)

      const packageJsonPath = path.resolve(node.data.root, 'package.json')
      const targetPkgJsonPath = path.join(targetPath, 'package.json')
      if (fs.existsSync(packageJsonPath) && !fs.existsSync(targetPkgJsonPath)) {
        await symlink(packageJsonPath, targetPkgJsonPath)
      }
    }))
}

const linkRecursive = async (pkg: Package, dependencyGraph: ProjectGraph, alreadyLinkedPkgs: Set<Package> = new Set()) => {
  if (alreadyLinkedPkgs.has(pkg)) {
    return
  }

  alreadyLinkedPkgs.add(pkg)

  await link(
    pkg.name,
    pkg.dependencies.map(dep => dep.name),
    dependencyGraph
  )

  await Promise.all(pkg.dependencies.map(dep =>
    linkRecursive(dep, dependencyGraph, alreadyLinkedPkgs)
  ))
}

const resolveDependenciesRecursive = (pkgName: string, dependencies: ProjectGraph['dependencies'], pkgCache: Map<string, Package> = new Map()): Package => {
  if (pkgCache.has(pkgName)) {
    return pkgCache.get(pkgName)
  }

  const pkg: Package = {
    name: pkgName,
    dependencies: []
  }
  pkgCache.set(pkgName, pkg)
  pkg.dependencies = dependencies[pkgName]
    .filter(dep => dep.type === 'static' && !dep.target.startsWith('npm:'))
    .map(dep => resolveDependenciesRecursive(dep.target, dependencies, pkgCache))
  
  return pkg
}

const flattenDependencies = (pkg: Package, includeSelf?: boolean, alreadyEncountered: Set<Package> = new Set()): string[] => {
  alreadyEncountered.add(pkg)

  const flattenedDependencies = uniq(flatten(
    pkg.dependencies
      .filter(dep => !alreadyEncountered.has(dep))
      .map(dep => flattenDependencies(dep, true, alreadyEncountered))
  ))

  return includeSelf
    ? [ pkg.name, ...flattenedDependencies ]
    : flattenedDependencies
}

interface Package {
  name: string;
  dependencies: Package[];
}

const symlink = promisify(fs.symlink)
