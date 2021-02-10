import { json } from '@angular-devkit/core'
import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import PQueue from 'p-queue'
import * as os from 'os'
import mkdirp from 'mkdirp'
import rimraf from 'rimraf'

interface Options extends json.JsonObject {
  outputPath: string;
  tsConfig: string;
  main: string;
}

const readFilePromise = promisify(fs.readFile)
const writeFilePromise = promisify(fs.writeFile)
const rimrafPromise = promisify(rimraf)

export default async function compileTypescript(
  options: Options,
  context
): Promise<{ success: boolean; }> {
  try {
    const baseDir = path.dirname(path.resolve(process.cwd(), options.tsConfig))
    await rimrafPromise(options.outputPath)
    const config = ts.parseJsonSourceFileConfigFileContent(
      ts.readJsonConfigFile(options.tsConfig, ts.sys.readFile),
      ts.sys,
      baseDir
    )

    const program = ts.createProgram([ path.resolve(options.main) ], {
      ...config.options,
      noEmit: true
    })
    const emitResult = program.emit()

    const allDiagnostics = ts
      .getPreEmitDiagnostics(program)
      .concat(emitResult.diagnostics)

    const queue = new PQueue({
      concurrency: os.cpus().length
    })

    for (const absoluteSourcePath of config.fileNames) {
      queue.add(async () => {
        const filePath = path.relative(baseDir, absoluteSourcePath)
        const source = await readFilePromise(absoluteSourcePath, 'utf-8')
        const transpiled = ts.transpileModule(source, {
          compilerOptions: config.options,
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
