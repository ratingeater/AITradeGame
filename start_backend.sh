#!/bin/bash
nohup python3 web/app.py > backend.log 2>&1 &
echo "Backend started with PID $!"
sleep 2
cat backend.log
