# BRUTOR

Google Cloud function that exposes a public API that our web app uses to upload photos to.
It then opens new pull requests in the GitHub repo.

## Setup

Create a GitHub fine-grained PAT for this repository with permission `Contents: Read and Write` and `Pull requests: Read and Write`.
Add the token to the GitHub repository secrets as `BRUTOR_GH_PAT`.
The deployment workflow will automatically pass this token to the Cloud Function as an environment variable.

In the Google Cloud project, create a service account with roles `Cloud Functions Admin`, `Cloud Run Admin` and `Service Account User`.
Create a Service Account key file and add as GitHub Actions secret `GCP_CREDENTIALS`.