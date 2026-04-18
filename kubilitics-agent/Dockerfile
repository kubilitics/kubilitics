FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.work go.work.sum ./
COPY kubilitics-backend ./kubilitics-backend
COPY kubilitics-agent ./kubilitics-agent
WORKDIR /src/kubilitics-agent
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/agent ./cmd/agent

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/agent /agent
USER nonroot:nonroot
ENTRYPOINT ["/agent"]
