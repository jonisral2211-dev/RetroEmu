FROM python:3.12-slim
WORKDIR /app
COPY jl_relay.py webpad.py webpad.html ./
EXPOSE 55436 8080
CMD ["python3", "-u", "jl_relay.py", "--port", "55436", "--http-port", "8080"]
