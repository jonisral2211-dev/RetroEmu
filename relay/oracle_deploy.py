"""Crea (o reutiliza) en Oracle Cloud Always Free todo lo que necesita JL Relay:
VCN + Internet Gateway + subred pública, reglas TCP 22 y 55436, instancia Ubuntu con la llave SSH
~/.ssh/jl_relay_oracle.pub (A1.Flex 1 OCPU / 6 GB, o E2.1.Micro si no hay capacidad) e IP pública
reservada. Idempotente: se puede volver a ejecutar. Usa ~/.oci/config.

    python relay/oracle_deploy.py
"""
import os
import sys
import time
from pathlib import Path

import oci

NAME = "jl-relay"
PORTS = [22, 55436, 8080]  # SSH, salas (TCP), mando web (HTTP/WebSocket)

config = oci.config.from_file()
tenancy = config["tenancy"]
compartment = tenancy  # compartimento raíz
net = oci.core.VirtualNetworkClient(config)
compute = oci.core.ComputeClient(config)
identity = oci.identity.IdentityClient(config)
ssh_key = (Path.home() / ".ssh" / "jl_relay_oracle.pub").read_text().strip()


def log(msg):
    print(msg, flush=True)


def wait_state(get, ok, timeout=600):
    t0 = time.time()
    while True:
        obj = get().data
        state = getattr(obj, "lifecycle_state", None)
        if state in ok:
            return obj
        if time.time() - t0 > timeout:
            raise TimeoutError(f"estado {state}")
        time.sleep(5)


# ---- Red ----------------------------------------------------------------------------------
vcns = [v for v in net.list_vcns(compartment).data if v.display_name == f"{NAME}-vcn" and v.lifecycle_state == "AVAILABLE"]
if vcns:
    vcn = vcns[0]
    log(f"VCN existente {vcn.id[-12:]}")
else:
    vcn = net.create_vcn(oci.core.models.CreateVcnDetails(
        compartment_id=compartment, cidr_blocks=["10.0.0.0/16"], display_name=f"{NAME}-vcn", dns_label="jlrelay")).data
    vcn = wait_state(lambda: net.get_vcn(vcn.id), ["AVAILABLE"])
    log("VCN creada")

igws = [g for g in net.list_internet_gateways(compartment, vcn_id=vcn.id).data if g.lifecycle_state == "AVAILABLE"]
igw = igws[0] if igws else net.create_internet_gateway(oci.core.models.CreateInternetGatewayDetails(
    compartment_id=compartment, vcn_id=vcn.id, is_enabled=True, display_name=f"{NAME}-igw")).data
igw = wait_state(lambda: net.get_internet_gateway(igw.id), ["AVAILABLE"])

rt = net.get_route_table(vcn.default_route_table_id).data
if not any(r.network_entity_id == igw.id for r in rt.route_rules):
    net.update_route_table(rt.id, oci.core.models.UpdateRouteTableDetails(route_rules=rt.route_rules + [
        oci.core.models.RouteRule(destination="0.0.0.0/0", destination_type="CIDR_BLOCK", network_entity_id=igw.id)]))
    log("ruta 0.0.0.0/0 -> Internet Gateway")

sl = net.get_security_list(vcn.default_security_list_id).data
have = {(r.protocol, r.tcp_options.destination_port_range.min if r.tcp_options and r.tcp_options.destination_port_range else None)
        for r in sl.ingress_security_rules}
new_rules = [oci.core.models.IngressSecurityRule(
    protocol="6", source="0.0.0.0/0", source_type="CIDR_BLOCK", is_stateless=False,
    description={22: "SSH", 8080: "JL mando web"}.get(p, f"JL Relay {p}"),
    tcp_options=oci.core.models.TcpOptions(destination_port_range=oci.core.models.PortRange(min=p, max=p)))
    for p in PORTS if ("6", p) not in have]
if new_rules:
    net.update_security_list(sl.id, oci.core.models.UpdateSecurityListDetails(
        ingress_security_rules=sl.ingress_security_rules + new_rules))
    log(f"Default Security List: abierto TCP {[r.tcp_options.destination_port_range.min for r in new_rules]}")

subnets = [s for s in net.list_subnets(compartment, vcn_id=vcn.id).data if s.lifecycle_state == "AVAILABLE"]
if subnets:
    subnet = subnets[0]
else:
    subnet = net.create_subnet(oci.core.models.CreateSubnetDetails(
        compartment_id=compartment, vcn_id=vcn.id, cidr_block="10.0.0.0/24", display_name=f"{NAME}-subnet",
        dns_label="pub", prohibit_public_ip_on_vnic=False, route_table_id=rt.id, security_list_ids=[sl.id])).data
    subnet = wait_state(lambda: net.get_subnet(subnet.id), ["AVAILABLE"])
    log("subred pública creada")

# ---- Instancia ----------------------------------------------------------------------------
existing = [i for i in compute.list_instances(compartment).data
            if i.display_name == NAME and i.lifecycle_state not in ("TERMINATED", "TERMINATING")]
if existing:
    inst = existing[0]
    log(f"instancia existente ({inst.shape}, {inst.lifecycle_state})")
else:
    ads = [a.name for a in identity.list_availability_domains(tenancy).data]

    def ubuntu_image(shape):
        imgs = compute.list_images(compartment, operating_system="Canonical Ubuntu", shape=shape,
                                   sort_by="TIMECREATED", sort_order="DESC").data
        for version in ("24.04", "22.04"):
            for img in imgs:
                if img.operating_system_version == version and "Minimal" not in img.display_name:
                    return img
        return None

    attempts = [("VM.Standard.A1.Flex", oci.core.models.LaunchInstanceShapeConfigDetails(ocpus=1, memory_in_gbs=6)),
                ("VM.Standard.E2.1.Micro", None)]
    inst = None
    for shape, shape_cfg in attempts:
        image = ubuntu_image(shape)
        if not image:
            log(f"{shape}: sin imagen Ubuntu disponible")
            continue
        for ad in ads:
            try:
                inst = compute.launch_instance(oci.core.models.LaunchInstanceDetails(
                    compartment_id=compartment, availability_domain=ad, display_name=NAME, shape=shape,
                    shape_config=shape_cfg,
                    source_details=oci.core.models.InstanceSourceViaImageDetails(image_id=image.id),
                    create_vnic_details=oci.core.models.CreateVnicDetails(subnet_id=subnet.id, assign_public_ip=False),
                    metadata={"ssh_authorized_keys": ssh_key})).data
                log(f"lanzando {shape} en {ad} con {image.display_name}")
                break
            except oci.exceptions.ServiceError as e:
                log(f"{shape} en {ad}: {e.code} {e.message[:90]}")
        if inst:
            break
    if not inst:
        sys.exit("No hay capacidad Always Free ahora mismo en ningún dominio. Reintenta en unos minutos.")

inst = wait_state(lambda: compute.get_instance(inst.id), ["RUNNING"], timeout=900)
log(f"instancia RUNNING ({inst.shape})")

# ---- IP pública reservada -----------------------------------------------------------------
vnic_att = compute.list_vnic_attachments(compartment, instance_id=inst.id).data[0]
private_ip = [p for p in net.list_private_ips(vnic_id=vnic_att.vnic_id).data if p.is_primary][0]
reserved = [ip for ip in net.list_public_ips("REGION", compartment, lifetime="RESERVED").data
            if ip.display_name == f"{NAME}-ip" and ip.lifecycle_state not in ("TERMINATED", "TERMINATING")]
if reserved:
    pub = reserved[0]
    if pub.private_ip_id != private_ip.id:
        net.update_public_ip(pub.id, oci.core.models.UpdatePublicIpDetails(private_ip_id=private_ip.id))
else:
    pub = net.create_public_ip(oci.core.models.CreatePublicIpDetails(
        compartment_id=compartment, lifetime="RESERVED", display_name=f"{NAME}-ip", private_ip_id=private_ip.id)).data
    log("IP pública reservada creada")
pub = wait_state(lambda: net.get_public_ip(pub.id), ["ASSIGNED"])
print(f"PUBLIC_IP={pub.ip_address}")
print(f"SHAPE={inst.shape}")
