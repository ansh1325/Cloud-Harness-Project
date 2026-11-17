"""
Sandboxed Agent Tools Interface
Provides tools for file inspection, surgical edits, and test command execution.
"""
from typing import Dict, Any, Optional
from sandbox.container_runner import SandboxEnvironment, SandboxExecutionResult


class AgentToolbox:
    """
    Wraps sandbox capabilities into safe, structured agent tools.
    """

    def __init__(self, sandbox: SandboxEnvironment):
        self.sandbox = sandbox

    def read_file(self, relative_path: str) -> str:
        """Reads the full content of a file within the sandbox."""
        return self.sandbox.read_file(relative_path)

    def write_file(self, relative_path: str, content: str) -> None:
        """Writes content to a file inside the sandbox."""
        self.sandbox.write_file(relative_path, content)

    def edit_file(self, relative_path: str, target: str, replacement: str) -> str:
        """Replaces exact target string with replacement inside a file."""
        self.sandbox.edit_file(relative_path, target, replacement)
        return f"Successfully updated {relative_path}"

    async def run_bash(self, command: str) -> SandboxExecutionResult:
        """Runs a bash command inside the sandbox."""
        return await self.sandbox.execute_command(command)

    async def run_pytest(self, test_path: str = "tests") -> SandboxExecutionResult:
        """Runs pytest supporting both sync and pytest-asyncio suites with concise tracebacks."""
        cmd = (
            f"python -m pytest {test_path} -v --tb=line --no-header "
            f"-W ignore::pytest.PytestDeprecationWarning -o asyncio_mode=auto"
        )
        return await self.sandbox.execute_command(cmd)

    async def check_python_syntax(self, file_paths: list[str]) -> SandboxExecutionResult:
        """Verifies modified Python files compile with zero syntax errors."""
        py_files = [p for p in file_paths if p.endswith(".py")]
        if not py_files:
            return SandboxExecutionResult(command="py_compile", exit_code=0, stdout="OK", stderr="", duration_ms=0.0)
        quoted = " ".join(f'"{p}"' for p in py_files)
        return await self.sandbox.execute_command(f"python -m py_compile {quoted}")
