packer {
  required_plugins {
    amazon = {
      version = ">= 1.3.0"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

# ── Variables ─────────────────────────────────────────────────

variable "version" {
  type    = string
  default = "0.6.0"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "instance_type" {
  type    = string
  # g4dn.xlarge = 1x T4 GPU, 16 GB RAM — cheapest CUDA instance
  # Use t3.xlarge for CPU-only AMI
  default = "g4dn.xlarge"
}

variable "repo_url" {
  type    = string
  default = "https://github.com/CoastalCrypto/Coastal.AI.git"
}

variable "repo_ref" {
  type    = string
  default = "master"
}

# ── Source AMI lookup ─────────────────────────────────────────

data "amazon-ami" "ubuntu-24-04" {
  region = var.region
  filters = {
    name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"
    root-device-type    = "ebs"
    virtualization-type = "hvm"
  }
  most_recent = true
  owners      = ["099720109477"] # Canonical
}

# ── Build ─────────────────────────────────────────────────────

source "amazon-ebs" "coastalos" {
  region        = var.region
  instance_type = var.instance_type
  source_ami    = data.amazon-ami.ubuntu-24-04.id

  ssh_username = "ubuntu"

  ami_name        = "coastalos-${var.version}-{{timestamp}}"
  ami_description = "CoastalClaw AI Agent OS v${var.version} — self-hosted AI on your hardware"

  ami_regions = [var.region]

  tags = {
    Name        = "CoastalOS ${var.version}"
    Version     = var.version
    Project     = "CoastalClaw"
    ManagedBy   = "packer"
  }

  launch_block_device_mappings {
    device_name           = "/dev/sda1"
    volume_size           = 60  # GB — enough for models + workspace
    volume_type           = "gp3"
    iops                  = 3000
    throughput            = 125
    delete_on_termination = true
  }
}

build {
  name    = "coastalos"
  sources = ["source.amazon-ebs.coastalos"]

  # Upload provisioning scripts
  provisioner "file" {
    source      = "${path.root}/../os/kiosk/build/hooks/post-install.sh"
    destination = "/tmp/post-install.sh"
  }

  # Desktop-edition-only units from os/kiosk/, plus the shared server/daemon/
  # architect units from os/base/ (the OS light de-dup moved them there).
  provisioner "file" {
    source      = "${path.root}/../os/kiosk/systemd/"
    destination = "/tmp/systemd/"
  }

  provisioner "file" {
    source      = "${path.root}/../os/base/systemd/"
    destination = "/tmp/systemd/"
  }

  # Run provisioner
  provisioner "shell" {
    environment_vars = [
      "CC_REPO_URL=${var.repo_url}",
      "CC_REPO_REF=${var.repo_ref}",
      "DEBIAN_FRONTEND=noninteractive",
    ]
    inline = [
      # Install systemd units
      "sudo cp /tmp/systemd/*.service /etc/systemd/system/",
      "sudo cp /tmp/systemd/*.timer  /etc/systemd/system/ 2>/dev/null || true",

      # Run post-install
      "sudo -E bash /tmp/post-install.sh",

      # Mark as AMI boot (skip live-boot steps)
      "sudo touch /etc/coastalclaw-ami",

      # Pre-pull default model if Ollama is running
      "sudo systemctl start ollama 2>/dev/null || true",
      "sleep 5",
      "ollama pull llama3.2 2>/dev/null || true",

      # Clean up
      "sudo apt-get clean",
      "sudo rm -rf /tmp/post-install.sh /tmp/systemd",
      "sudo truncate -s 0 /var/log/syslog /var/log/auth.log 2>/dev/null || true",
    ]
  }

  post-processor "manifest" {
    output     = "packer/manifest.json"
    strip_path = true
  }
}
