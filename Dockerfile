FROM node:18-alpine

# Instala FFmpeg
RUN apk add --no-cache ffmpeg

# Cria diretório
WORKDIR /app

# Copia arquivos
COPY package*.json ./
RUN npm install --production

COPY . .

# Expõe porta
EXPOSE 3000

# Inicia
CMD ["node", "server.js"]
```
