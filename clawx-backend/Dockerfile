FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/server ./cmd/server

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /bin/server /bin/server
COPY configs ./configs
EXPOSE 9090
CMD ["/bin/server"]
