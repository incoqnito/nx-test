import { json } from '@angular-devkit/core'
import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import { promisify } from 'util'
import rimraf from 'rimraf'
import nodemon from 'nodemon'
import mkdirp from 'mkdirp'

interface Options extends json.JsonObject {
  outputPath: string;
  tsConfig: string;
  main: string;
}

const rimrafPromise = promisify(rimraf)
const link = promisify(fs.symlink)
const writeFile = promisify(fs.writeFile)

export default async function compileTypescript(
  options: Options,
  context
): Promise<{ success: boolean; }> {
  try {
    const baseDir = path.dirname(path.resolve(process.cwd(), options.tsConfig))
    const config = ts.parseJsonSourceFileConfigFileContent(
      ts.readJsonConfigFile(options.tsConfig, ts.sys.readFile),
      ts.sys,
      baseDir
    )
    await rimrafPromise(config.options.outDir)

    const localNodeModulesPath = path.resolve(options.outputPath, 'node_modules')
    await mkdirp(localNodeModulesPath)
    await Promise.all(Object.entries(config.options.paths || {}).map(async ([ packageName, relativePaths ]) => {
      if (relativePaths.length !== 1) {
        throw new Error('Currently path mappings with a length not equal to 1 are not supported.')
      }

      const sourcePath = path.resolve(config.options.rootDir, 'dist', relativePaths[0], '../..') // TODO: remove hardcoded paths
      const targetPath = path.join(localNodeModulesPath, packageName)
      console.log(`linking ${sourcePath} -> ${targetPath}`)

      await mkdirp(sourcePath)
      await mkdirp(path.join(targetPath, '..'))
      
      await link(sourcePath, targetPath)

      const packageJsonPath = path.resolve(config.options.rootDir, relativePaths[0], '../../package.json')
      console.log('pkg', packageJsonPath)
      if (fs.existsSync(packageJsonPath)) {
        await link(packageJsonPath, path.join(sourcePath, 'package.json'))
      }
    }))

    ts.sys.clearScreen = () => {
      console.log('\n---------------------\n')
    }
    const watchCompilerHost = ts.createWatchCompilerHost([ options.main ], config.options, ts.sys, undefined,undefined, undefined, config.projectReferences, config.watchOptions)
    const watchProgram = ts.createWatchProgram(watchCompilerHost)

    nodemon({
      script: path.join(path.dirname(path.resolve(config.options.outDir, path.relative(config.options.rootDir, options.main))), path.basename(options.main, '.ts') + '.js'),
      ext: 'js json'
    })

    nodemon
      .on('start', () => {
        console.log('[nodemon] Watching...')
      })
      .on('quit', () => {
        watchProgram.close()
        process.exit()
      })
      .on('restart', (files) => {
        if (files) {
          console.log(`[nodemon] Changes detected: ${files.map(file => path.relative(config.options.outDir, file)).join(', ')}`)
        } else {
          console.log('[nodemon] Manual restart')
        }
      })

    await new Promise(() => {})
  } catch (error) {
    console.error(error)

    return {
      success: false
    }
  }
}
