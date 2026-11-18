---
description: Create commit with detailed comment
---

Please create a comprehensive checkpoint commit with the following steps:

1. **Initialize Git if needed**: Run `git init` if git has not been instantiated for the project yet.

2. **Analyze all changes**:
   - Run `git status` to see all tracked and untracked files
   - Run `git diff` to see detailed changes in tracked files
   - Run `git log -5 --oneline` to understand the commit message style of this repository

3. **Stage everything**:
   - Stage all modified, deleted and new files (`git add -A`), except files that hold secrets or machine-local config (`.env*`, credentials, keys), because a committed secret has to be rotated; name anything you leave out

4. **Create a detailed commit message**:
   - **First line**: Write a clear, concise summary (50-72 chars) describing the primary change
     - Use imperative mood (e.g., "Add feature" not "Added feature")
     - Examples: "feat: add user authentication", "fix: resolve database connection issue", "refactor: improve API route structure"
   - **Body**: Provide a detailed description including:
     - What changes were made (list of key modifications)
     - Why these changes were made (purpose/motivation)
     - Any important technical details or decisions
     - Breaking changes or migration notes if applicable
   - **Footer**: End with the commit attribution lines this session's instructions specify, if any

5. **Execute the commit**: Create the commit with the properly formatted message following this repository's conventions.

Notes:

- Make the commit message descriptive enough that someone reviewing the git log can understand what was accomplished
- Follow the project's existing commit message conventions (check git log first)
