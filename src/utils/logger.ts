import chalk from "chalk";

export const log = {
  info(msg: string) {
    console.log(chalk.cyan("ℹ"), msg);
  },
  ok(msg: string) {
    console.log(chalk.green("✓"), msg);
  },
  warn(msg: string) {
    console.log(chalk.yellow("⚠"), msg);
  },
  error(msg: string) {
    console.error(chalk.red("✗"), msg);
  },
  step(n: number, title: string) {
    console.log(chalk.bold.white(`\n[${n}] ${title}`));
  },
};
