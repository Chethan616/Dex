"""
Every name a Python agent uses is a name that exists.

This exists because of a bug that reached the owner. Rewriting a block in
`agents/browser/server.py` deleted `_ask_model` along with the code around it,
and the call to it three lines above survived. Nothing caught it: the file
parses, it imports, and the only way to reach the broken line is to run a real
web task — which is what the owner did, and got

    NameError: name '_ask_model' is not defined

after twelve seconds and a confirmation card.

`ast.parse` cannot catch this and neither can an import: the name is looked up
when the function runs, not when the module loads. What catches it is checking
that every name a function body reads is defined *somewhere* it could come
from — a module-level definition, an import, a parameter, a local, a builtin.
That is what pyflakes does, and this is the small piece of it that pays for
itself here, with no dependency to install.

It is deliberately conservative. Anything it cannot resolve confidently is
ignored rather than reported, because a checker that cries wolf gets switched
off and then catches nothing at all.
"""
from __future__ import annotations

import ast
import builtins
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Where the agents live. Not `tests/` — a test that references a fixture it
# builds dynamically is fine and not what this is for.
ROOTS = ['agents', 'daemon', 'scripts']

passed = 0
failed = 0


def check(name: str, ok: bool, detail: str = '') -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok   {name}')
    else:
        failed += 1
        print(f'  FAIL {name}' + (f' -- {detail}' if detail else ''))


class Scope:
    """Names visible at one level: a module, a function, a comprehension."""

    def __init__(self, parent: 'Scope | None' = None) -> None:
        self.parent = parent
        self.names: set[str] = set()

    def add(self, name: str) -> None:
        if name:
            self.names.add(name)

    def has(self, name: str) -> bool:
        scope: Scope | None = self
        while scope is not None:
            if name in scope.names:
                return True
            scope = scope.parent
        return False


BUILTINS = set(dir(builtins)) | {'__file__', '__name__', '__doc__', '__package__'}


def bind_target(node: ast.AST, scope: Scope) -> None:
    """Every name a binding form introduces: a, (a, b), [a, *rest], a.b (no)."""
    if isinstance(node, ast.Name):
        scope.add(node.id)
    elif isinstance(node, (ast.Tuple, ast.List)):
        for item in node.elts:
            bind_target(item, scope)
    elif isinstance(node, ast.Starred):
        bind_target(node.value, scope)
    # Attribute and Subscript targets bind nothing new.


def declare(node: ast.AST, scope: Scope) -> None:
    """Names a statement makes available to the rest of its scope."""
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        scope.add(node.name)
    elif isinstance(node, (ast.Import, ast.ImportFrom)):
        for alias in node.names:
            scope.add(alias.asname or alias.name.split('.')[0])
    elif isinstance(node, ast.Assign):
        for target in node.targets:
            bind_target(target, scope)
    elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        bind_target(node.target, scope)
    elif isinstance(node, (ast.For, ast.AsyncFor)):
        bind_target(node.target, scope)
    elif isinstance(node, (ast.With, ast.AsyncWith)):
        for item in node.items:
            if item.optional_vars is not None:
                bind_target(item.optional_vars, scope)
    elif isinstance(node, ast.Try):
        for handler in node.handlers:
            scope.add(handler.name or '')
    elif isinstance(node, ast.Global) or isinstance(node, ast.Nonlocal):
        for name in node.names:
            scope.add(name)
    elif isinstance(node, ast.NamedExpr):
        bind_target(node.target, scope)
    elif isinstance(node, ast.comprehension):
        # `[y for y in xs]`. A comprehension has its own scope in Python 3, but
        # binding it into the enclosing one is the conservative direction: this
        # checker is here to catch names that exist nowhere, not to police
        # where they leak from.
        bind_target(node.target, scope)
    elif isinstance(node, ast.Lambda):
        args = node.args
        for group in (args.posonlyargs, args.args, args.kwonlyargs):
            for arg in group:
                scope.add(arg.arg)
        if args.vararg:
            scope.add(args.vararg.arg)
        if args.kwarg:
            scope.add(args.kwarg.arg)


def collect(body: list[ast.stmt], scope: Scope) -> None:
    """
    Everything this block binds, at any depth inside it but not inside a
    nested function — those have their own scope and are walked separately.
    """
    for statement in body:
        for node in ast.walk(statement):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # Its name is bound here; its body is not this scope's business.
                declare(node, scope)
                continue
            declare(node, scope)


def function_scope(node, parent: Scope) -> Scope:
    scope = Scope(parent)
    args = node.args
    for group in (args.posonlyargs, args.args, args.kwonlyargs):
        for arg in group:
            scope.add(arg.arg)
    if args.vararg:
        scope.add(args.vararg.arg)
    if args.kwarg:
        scope.add(args.kwarg.arg)
    collect(node.body, scope)
    return scope


def undefined_in(path: Path) -> list[str]:
    """Names read by a function in this file that nothing could provide."""
    try:
        tree = ast.parse(path.read_text(encoding='utf-8', errors='ignore'), str(path))
    except SyntaxError as exc:
        return [f'{path.name}: does not parse — {exc}']

    module = Scope()
    collect(tree.body, module)

    problems: list[str] = []

    def walk_function(node, parent: Scope) -> None:
        scope = function_scope(node, parent)
        for statement in node.body:
            visit(statement, scope)

    def visit(node: ast.AST, scope: Scope) -> None:
        """
        Every name read here, without crossing into a nested function.

        `ast.walk` was the obvious way and it was wrong: it flattens the whole
        subtree, so a nested `def on_step(step_num, action)` had its parameters
        bound in its own scope and its *body* checked against the enclosing one,
        where `action` does not exist. Ten false reports, all of that shape.

        A nested function is walked separately, against a scope that has its
        parameters in it.
        """
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            walk_function(node, scope)
            return
        if isinstance(node, ast.Lambda):
            inner = Scope(scope)
            args = node.args
            for group in (args.posonlyargs, args.args, args.kwonlyargs):
                for arg in group:
                    inner.add(arg.arg)
            if args.vararg:
                inner.add(args.vararg.arg)
            if args.kwarg:
                inner.add(args.kwarg.arg)
            visit(node.body, inner)
            return

        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            if node.id not in BUILTINS and not scope.has(node.id):
                problems.append(
                    f'{path.relative_to(ROOT)}:{node.lineno}: {node.id} is not defined'
                )
            return

        for child in ast.iter_child_nodes(node):
            visit(child, scope)

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            walk_function(node, module)
        elif isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    # Class bodies are not a scope their methods can read from,
                    # so methods are checked against the module.
                    walk_function(item, module)

    return problems


def main() -> None:
    print('\nnames that have to exist')

    files = sorted(
        path
        for root in ROOTS
        for path in (ROOT / root).rglob('*.py')
        if '__pycache__' not in path.parts and 'node_modules' not in path.parts
    )
    check('there are agent files to check', len(files) > 5, str(len(files)))

    problems: list[str] = []
    for path in files:
        problems.extend(undefined_in(path))

    if problems:
        for problem in problems[:20]:
            print(f'       {problem}')
    check(
        f'every name used in {len(files)} files resolves',
        not problems,
        f'{len(problems)} undefined',
    )

    print('\nand the checker itself works')

    # The exact shape of the bug this was written for: a call to a helper that
    # was deleted with the code around it.
    broken = ROOT / 'tests' / '_names_probe.py'
    broken.write_text(
        'async def run():\n'
        '    return await _ask_model("x")\n',
        encoding='utf-8',
    )
    try:
        found = undefined_in(broken)
        check('a deleted helper is caught',
              any('_ask_model' in p for p in found), str(found))
    finally:
        broken.unlink(missing_ok=True)

    print(f'\n{passed} passed, {failed} failed')
    if failed:
        sys.exit(1)
    print('PASSED  no agent calls a name that is not there.')


if __name__ == '__main__':
    main()
