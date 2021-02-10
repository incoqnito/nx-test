import { json } from '@angular-devkit/core'
import * as ts from 'typescript'
import * as path from 'path'
import { promisify } from 'util'
import rimraf from 'rimraf'
import nodemon from 'nodemon'
import linkDependencies from '../../shared/linkDependencies'

interface Options extends json.JsonObject {
  outputPath: string;
  tsConfig: string;
  main: string;
}

const rimrafPromise = promisify(rimraf)

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

    await linkDependencies(context.projectName, false)

    ts.sys.clearScreen = () => {
      console.log('\n---------------------\n')
    }
    const watchCompilerHost = ts.createWatchCompilerHost([ options.main ], config.options, ts.sys, undefined, undefined, undefined, config.projectReferences, config.watchOptions)
    const watchProgram = ts.createWatchProgram(watchCompilerHost)

    const outputMain = path.join(path.dirname(path.resolve(config.options.outDir, path.relative(config.options.rootDir, options.main))), path.basename(options.main, '.ts') + '.js')
    nodemon({
      script: outputMain,
      ext: 'js json'
    })

    nodemon
      .on('start', () => {
        console.log('\n[nodemon] Watching...')
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
