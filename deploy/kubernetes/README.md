# Kubernetes deployment example

This directory is a production-oriented baseline, not a turnkey cloud stack. It
expects managed PostgreSQL, Redis and S3-compatible storage, an NGINX Ingress
Controller, Metrics Server, a TLS issuer, and an external secret-management
solution.

1. Replace `agents.example.com`, bucket names and image references.
2. Build the web image with
   `--build-arg NEXT_PUBLIC_API_URL=https://agents.example.com/api/v1` and
   `--build-arg API_PROXY_URL=http://agent-platform-api:4000`. These rewrite
   values are embedded at build time; changing only the ConfigMap is insufficient.
   Build the API Dockerfile twice: `--target runtime` for the API Deployment and
   `--target migration` for the migration Job. Publish both immutable images.
3. Apply `namespace.yaml`, then create `agent-platform-secrets` through your
   secret manager. `secret.example.yaml` must never contain real credentials.
   For Gemini Vertex, bind the API ServiceAccount to a least-privilege Google
   workload identity; do not mount a long-lived service-account JSON key.
4. Apply `configmap.yaml`, `service-account.yaml` and `migration-job.yaml`, then
   wait for the migration Job to complete.
5. Run `kubectl apply -k deploy/kubernetes` to roll out API, web, ingress, PDB,
   HPA and ingress isolation policies.

The included NetworkPolicy denies unsolicited pod ingress and permits traffic
from an `ingress-nginx` namespace. Outbound restrictions are intentionally left
to the deployment environment because the API must reach provider endpoints and
managed services. Enforce FQDN egress policies with a capable CNI and allow only
approved AI-provider and tool domains.
