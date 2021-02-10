import { lambdaLibLib } from '@monorepo-example/lambda-lib-lib'

export function lambdaLib(): string {
  return "lambda-lib " + lambdaLibLib()
}
