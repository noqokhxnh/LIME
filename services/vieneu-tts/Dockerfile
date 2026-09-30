FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# Cài đặt uv để tăng tốc cài thư viện Python
RUN pip install --no-cache-dir uv

# Cài đặt các thư viện cần thiết (ONNX Runtime CPU, không cần torch nặng)
COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

# Nạp sẵn mô hình v3nano vào cache khi build image (đặt trước COPY server.py để không tải lại khi sửa code)
RUN python -c "from vieneu import Vieneu; Vieneu(mode='v3nano')"

COPY server.py .

EXPOSE 7860

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
