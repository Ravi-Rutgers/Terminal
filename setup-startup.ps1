$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-Command pm2 resurrect"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "PM2-Hussle" -Action $action -Trigger $trigger -RunLevel Highest -Force
