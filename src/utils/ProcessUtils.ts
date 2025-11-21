import { exec, execFile, ExecOptions } from "child_process";
import { promisify } from "util";

export const execAsync = promisify(exec);

export interface RunCommandResult {
	stdout: string
	stderr: string
	failed: boolean
}

export const runCommand = async (
	command: string,
	options: ExecOptions = {},
): Promise<RunCommandResult> => {
	try {
		const execOptions: ExecOptions = {
			maxBuffer: 10 * 1024 * 1024,
			...options,
		};
		const { stdout, stderr } = (await execAsync(command, execOptions)) as {
			stdout?: string | Buffer
			stderr?: string | Buffer
		};
		const stdoutStr = typeof stdout === "string" ? stdout : stdout?.toString() ?? "";
		const stderrStr = typeof stderr === "string" ? stderr : stderr?.toString() ?? "";
		return {
			stdout: stdoutStr,
			stderr: stderrStr,
			failed: false,
		};
	} catch (error) {
		const execError = error as Error & {
			stdout?: string | Buffer
			stderr?: string | Buffer
		};
		const stdoutStr = typeof execError.stdout === "string" ? execError.stdout : execError.stdout?.toString() ?? "";
		const stderrStr =
			typeof execError.stderr === "string"
				? execError.stderr
				: execError.stderr?.toString() ?? execError.message ?? "";
		return {
			stdout: stdoutStr,
			stderr: stderrStr,
			failed: true,
		};
	}
};


type WhereisOptions = {
	encoding: 'buffer' | null;
};

export const whereis = (command: string, options?: ExecOptions & WhereisOptions) => {
	return new Promise((resolve, reject) => {
		if (!command) {
			return reject(new Error('No command name is passed!'));
		}
		const commandStr = /(win32)/.test(process.platform) ? `${command}.exe` : command;
		execFile('which', [commandStr], options, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`Could not find ${command} on your system; ${error.message ? error.message : ''}`));
				return;
			}
			const str = stdout.toString().split('\n')[0];
			if (str === '' || str.charAt(0) !== '/') {
				reject(new Error(`Could not find ${command} on your system;`));
			}
			resolve(str);
		});
	});
};