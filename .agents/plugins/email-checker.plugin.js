export const description = "Email checker plugin using gog CLI tool"

export default {
  tools: {
    check_emails: {
      description: "Check recent emails using gog CLI tool",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of recent emails to check (default: 3)",
            default: 3
          }
        }
      },
      handler: async ({ limit = 3 }) => {
        try {
          const gogPath = `${process.env.HOME}/OSS/playground-cef/openclaw/gogcli/bin/gog`
          const cmd = Bun.spawn([gogPath, "gmail", "search", "--limit", limit.toString(), "is:inbox"], {
            stdout: "pipe",
            stderr: "pipe"
          })
          
          const output = await new Response(cmd.stdout).text()
          const error = await new Response(cmd.stderr).text()
          const exitCode = await cmd.exited
          
          if (exitCode !== 0) {
            return {
              success: false,
              error: error || `gog command failed with exit code ${exitCode}`
            }
          }
          
          const lines = output.trim().split('\n').slice(1) // Skip header
          const emails = lines.map(line => {
            const parts = line.trim().split(/\s{2,}/)
            return {
              id: parts[0] || '',
              date: parts[1] || '',
              from: parts[2] || '',
              subject: parts[3] || '',
              labels: parts[4] || ''
            }
          }).filter(email => email.id)
          
          return {
            success: true,
            count: emails.length,
            emails: emails.slice(0, limit)
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      }
    }
  }
}