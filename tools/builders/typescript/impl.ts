import { json } from '@angular-devkit/core'
import * as ts from 'typescript'
import mergeDeep from 'merge-deep'
import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import glob from 'fast-glob'
import PQueue from 'p-queue'
import * as os from 'os'
import mkdirp from 'mkdirp'
import rimraf from 'rimraf'

interface Options extends json.JsonObject {
  outputPath: string;
  tsConfig: string;
  main: string;
}

interface JSONCompilerOptions extends Omit<ts.CompilerOptions, 'moduleResolution'> {
  moduleResolution?: string;
}

interface TSConfig<TOptions = JSONCompilerOptions> {
  extends?: string;
  compilerOptions: TOptions;
  include?: string[];
  exclude?: string[];
}

const readFilePromise = promisify(fs.readFile)
const writeFilePromise = promisify(fs.writeFile)
const rimrafPromise = promisify(rimraf)

const resolveTsConfigRecursive = async (configPath: string | undefined, basePath: string = process.cwd(), configs: TSConfig[] = []): Promise<TSConfig[]> => {
  if (typeof configPath === 'undefined') {
    return configs
  }

  const absoluteConfigPath = path.resolve(basePath, configPath)
  const config: TSConfig = JSON.parse(await readFilePromise(absoluteConfigPath, 'utf-8'))
  return resolveTsConfigRecursive(config.extends, path.dirname(absoluteConfigPath), [ config, ...configs ])
}
const resolveTsConfig = async (path: string): Promise<TSConfig<ts.CompilerOptions>> => {
  const config: TSConfig = mergeDeep({}, ...await resolveTsConfigRecursive(path))

  return {
    ...config,
    compilerOptions: parseJSONTSConfig(config.compilerOptions)
  }
}

const parseJSONTSConfig = (config: JSONCompilerOptions): ts.CompilerOptions => ({
  ...config,
  moduleResolution: config.moduleResolution && (config.moduleResolution === 'node'
    ? ts.ModuleResolutionKind.NodeJs
    : ts.ModuleResolutionKind.Classic
  )
})

export default async function compileTypescript(
  options: Options,
  context
): Promise<{ success: boolean; }> {
  try {
    const baseDir = path.dirname(path.resolve(process.cwd(), options.tsConfig))
    await rimrafPromise(options.outputPath)
    const config = await resolveTsConfig(options.tsConfig)

    const program = ts.createProgram([ path.resolve(options.main) ], {
      ...config.compilerOptions,
      noEmit: true
    })
    const emitResult = program.emit()

    const allDiagnostics = ts
      .getPreEmitDiagnostics(program)
      .concat(emitResult.diagnostics)

    const filePaths = await glob(config.include || '**/*.ts', {
      cwd: baseDir,
      ignore: config.exclude
    })

    const queue = new PQueue({
      concurrency: os.cpus().length
    })

    let success = true
    for (const filePath of filePaths) {
      queue.add(async () => {
        const absoluteSourcePath = path.resolve(baseDir, filePath)
        const source = await readFilePromise(absoluteSourcePath, 'utf-8')
        const transpiled = ts.transpileModule(source, {
          compilerOptions: config.compilerOptions,
          fileName: filePath
        })
        ts.getPreEmitDiagnostics

        const targetPath = path.join(path.dirname(path.resolve(
          options.outputPath,
          filePath
        )), path.basename(filePath, '.ts') + '.js')

        await mkdirp(path.dirname(targetPath))
        await writeFilePromise(targetPath, transpiled.outputText)
        if (transpiled.sourceMapText) {
          await writeFilePromise(targetPath + '.map', transpiled.sourceMapText)
        }

        // console.log(`wrote ${absoluteSourcePath} -> ${targetPath}`)
      })
    }

    for (const diagnostic of allDiagnostics) {
      if (diagnostic.file) {
        let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
        let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
      } else {
        console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      }
    }

    await queue.onIdle()

    return {
      success: !emitResult.emitSkipped
    }
  } catch (error) {
    console.error(error)

    return {
      success: false
    }
  }
}
